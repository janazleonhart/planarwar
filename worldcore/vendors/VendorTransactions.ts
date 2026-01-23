// worldcore/vendors/VendorTransactions.ts
//
// Vendor transaction logic (v0+) with anti-dupe guardrails.
//
// Goals:
// - Never charge gold unless we can deliver items.
// - Never deliver items unless gold is charged.
// - Never partially mutate state on failure (atomic via snapshot/rollback).
// - Keep command layer thin; this module returns structured results.

import type { CharacterState, InventoryState } from "../characters/CharacterTypes";
import {
  getCharacterGold,
  trySpendGold,
  giveGold,
  tryConsumeItems,
  giveItemsToCharacter,
  SimpleItemStack,
} from "../economy/EconomyHelpers";
import type { VendorDefinition, VendorItem } from "./VendorTypes";

export type VendorBuyResult = {
  ok: boolean;
  message: string;
  item?: VendorItem;
  quantity?: number;
  goldSpent?: number;
  goldBefore?: number;
  goldAfter?: number;
};

export type VendorSellResult = {
  ok: boolean;
  message: string;
  itemId?: string;
  quantity?: number;
  goldGained?: number;
  goldBefore?: number;
  goldAfter?: number;
};

function cloneInventory(inv: InventoryState): InventoryState {
  // InventoryState is JSON-safe in this project. A structural clone is enough.
  return JSON.parse(JSON.stringify(inv)) as InventoryState;
}

function restoreInventory(char: CharacterState, snapshot: InventoryState): void {
  // Restore by replacing the whole inventory object.
  (char as any).inventory = snapshot;
}

function countItem(inv: InventoryState, itemId: string): number {
  let total = 0;
  for (const bag of inv.bags ?? []) {
    for (const slot of bag.slots ?? []) {
      if (slot?.itemId === itemId) total += Number((slot as any).qty ?? 0);
    }
  }
  return total;
}

/**
 * Find a vendor item either by row id or by index (1-based).
 * This keeps the command layer simple: you can pass either
 * the DB `id` or a list index the player typed.
 */
export function resolveVendorItem(
  vendor: VendorDefinition,
  selector: number
): VendorItem | undefined {
  // Try exact row id first
  let item = vendor.items.find((i) => i.id === selector);
  if (item) return item;

  // Fallback: 1-based index in vendor.items
  const idx = selector - 1;
  if (idx >= 0 && idx < vendor.items.length) {
    return vendor.items[idx];
  }

  return undefined;
}

/**
 * Attempt to buy `quantity` of a vendor item for the character.
 *
 * - Checks gold first (no partial purchase if they can't afford).
 * - Then tries to add items to inventory.
 * - Only spends gold for the quantity actually added.
 *
 * Anti-dupe guardrails:
 * - Snapshot + rollback if payment fails.
 * - Validate gold & item deltas are exactly what we expect.
 */
export function buyFromVendor(
  char: CharacterState,
  vendor: VendorDefinition,
  vendorItemSelector: number,
  quantity: number
): VendorBuyResult {
  const item = resolveVendorItem(vendor, vendorItemSelector);
  if (!item) {
    return {
      ok: false,
      message: "[vendor] That item is not sold here.",
    };
  }

  const qty = quantity > 0 ? quantity : 1;
  const requestedTotalCost = item.priceGold * qty;

  const goldBefore = getCharacterGold(char);
  const invBeforeSnapshot = cloneInventory(char.inventory);
  const itemCountBefore = countItem(invBeforeSnapshot, item.itemId);

  if (goldBefore < requestedTotalCost) {
    return {
      ok: false,
      message: `[vendor] You cannot afford that. Cost: ${requestedTotalCost} gold.`,
      item,
      quantity: 0,
      goldSpent: 0,
      goldBefore,
      goldAfter: goldBefore,
    };
  }

  // Try to add items first, so we never charge gold if we can't deliver.
  const giveResult = giveItemsToCharacter(char, [{ itemId: item.itemId, quantity: qty }]);

  const applied = giveResult.applied.find((s) => s.itemId === item.itemId);
  const appliedQty = applied?.quantity ?? 0;

  if (appliedQty <= 0) {
    // Ensure no partial state (bags full might still be no-op, but snapshot makes it explicit).
    restoreInventory(char, invBeforeSnapshot);
    return {
      ok: false,
      message: "[vendor] Your bags are full; you can't carry that purchase.",
      item,
      quantity: 0,
      goldSpent: 0,
      goldBefore,
      goldAfter: goldBefore,
    };
  }

  const actualCost = appliedQty * item.priceGold;

  // Spend gold for what we actually added.
  if (!trySpendGold(char, actualCost)) {
    // Roll back item grant if payment fails (prevents silent dupes).
    restoreInventory(char, invBeforeSnapshot);
    return {
      ok: false,
      message: "[vendor] An error occurred while processing payment. Please try again.",
      item,
      quantity: 0,
      goldSpent: 0,
      goldBefore,
      goldAfter: goldBefore,
    };
  }

  // Validate invariants: gold and item counts match exactly what we expect.
  const goldAfter = getCharacterGold(char);
  const itemCountAfter = countItem(char.inventory, item.itemId);

  const expectedGoldAfter = goldBefore - actualCost;
  const expectedItemAfter = itemCountBefore + appliedQty;

  if (goldAfter !== expectedGoldAfter || itemCountAfter !== expectedItemAfter) {
    // Something mutated unexpectedly (bad stacking logic, re-entrancy, etc). Roll back.
    restoreInventory(char, invBeforeSnapshot);
    return {
      ok: false,
      message: "[vendor] Transaction integrity check failed. No changes were applied.",
      item,
      quantity: 0,
      goldSpent: 0,
      goldBefore,
      goldAfter: goldBefore,
    };
  }

  // If some requested quantity could not be added, warn the player
  let msg: string;
  if (appliedQty < qty) {
    msg = `[vendor] You buy ${appliedQty}x ${item.itemId} for ${actualCost} gold (bags were too full for the rest).`;
  } else {
    msg = `[vendor] You buy ${appliedQty}x ${item.itemId} for ${actualCost} gold.`;
  }

  return {
    ok: true,
    message: msg,
    item,
    quantity: appliedQty,
    goldSpent: actualCost,
    goldBefore,
    goldAfter,
  };
}

/**
 * Sell items to a vendor for gold.
 *
 * For v0 we use a simple rule:
 *   vendor pays 50% of their sell price (rounded down).
 *
 * Anti-dupe guardrails:
 * - Snapshot + rollback if any part fails.
 * - Validate gold & item deltas exactly match what we expect.
 */
export function sellToVendor(
  char: CharacterState,
  itemId: string,
  quantity: number,
  vendor: VendorDefinition
): VendorSellResult {
  const qty = quantity > 0 ? quantity : 1;

  // Find a price reference from this vendor if they also sell it.
  const vendorItem = vendor.items.find((i) => i.itemId === itemId);
  if (!vendorItem) {
    return {
      ok: false,
      message: "[vendor] This vendor is not interested in buying that item.",
      itemId,
      quantity: 0,
      goldGained: 0,
      goldBefore: getCharacterGold(char),
      goldAfter: getCharacterGold(char),
    };
  }

  const basePrice = vendorItem.priceGold;
  const sellPricePerUnit = Math.floor(basePrice * 0.5);

  if (sellPricePerUnit <= 0) {
    return {
      ok: false,
      message: "[vendor] That item has no resale value.",
      itemId,
      quantity: 0,
      goldGained: 0,
      goldBefore: getCharacterGold(char),
      goldAfter: getCharacterGold(char),
    };
  }

  const goldBefore = getCharacterGold(char);
  const invBeforeSnapshot = cloneInventory(char.inventory);
  const itemCountBefore = countItem(invBeforeSnapshot, itemId);

  // Remove items as an all-or-nothing cost
  const ok = tryConsumeItems(char, [{ itemId, quantity: qty } as SimpleItemStack]);

  if (!ok) {
    // Ensure no partial state (tryConsumeItems should be atomic, but snapshot makes it explicit).
    restoreInventory(char, invBeforeSnapshot);
    return {
      ok: false,
      message: "[vendor] You do not have enough of that item to sell.",
      itemId,
      quantity: 0,
      goldGained: 0,
      goldBefore,
      goldAfter: goldBefore,
    };
  }

  const goldGain = sellPricePerUnit * qty;
  giveGold(char, goldGain);

  const goldAfter = getCharacterGold(char);
  const itemCountAfter = countItem(char.inventory, itemId);

  const expectedGoldAfter = goldBefore + goldGain;
  const expectedItemAfter = itemCountBefore - qty;

  if (goldAfter !== expectedGoldAfter || itemCountAfter !== expectedItemAfter) {
    restoreInventory(char, invBeforeSnapshot);
    return {
      ok: false,
      message: "[vendor] Transaction integrity check failed. No changes were applied.",
      itemId,
      quantity: 0,
      goldGained: 0,
      goldBefore,
      goldAfter: goldBefore,
    };
  }

  return {
    ok: true,
    message: `[vendor] You sell ${qty}x ${itemId} for ${goldGain} gold.`,
    itemId,
    quantity: qty,
    goldGained: goldGain,
    goldBefore,
    goldAfter,
  };
}
