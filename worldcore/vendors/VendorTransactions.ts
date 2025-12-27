// worldcore/vendors/VendorTransactions.ts

import type { CharacterState } from "../characters/CharacterTypes";
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
};

export type VendorSellResult = {
  ok: boolean;
  message: string;
  itemId?: string;
  quantity?: number;
  goldGained?: number;
};

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

  const currentGold = getCharacterGold(char);
  if (currentGold < requestedTotalCost) {
    return {
      ok: false,
      message: `[vendor] You cannot afford that. Cost: ${requestedTotalCost} gold.`,
    };
  }

  // Try to add items first, so we never charge gold if we can't deliver.
  const giveResult = giveItemsToCharacter(char, [
    { itemId: item.itemId, quantity: qty },
  ]);

  const applied = giveResult.applied.find(
    (s) => s.itemId === item.itemId
  );
  const appliedQty = applied?.quantity ?? 0;

  if (appliedQty <= 0) {
    return {
      ok: false,
      message:
        "[vendor] Your bags are full; you can't carry that purchase.",
    };
  }

  const actualCost = appliedQty * item.priceGold;

  // Spend gold for what we actually added
  if (!trySpendGold(char, actualCost)) {
    // Extremely unlikely given we checked affordability above,
    // but if it happens we just warn and leave the items as-is.
    return {
      ok: false,
      message:
        "[vendor] An error occurred while processing payment. Please try again.",
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
  };
}

/**
 * Sell items to a vendor for gold.
 *
 * For v0 we use a simple rule:
 *   vendor pays 50% of their sell price (rounded down).
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
      message:
        "[vendor] This vendor is not interested in buying that item.",
    };
  }

  const basePrice = vendorItem.priceGold;
  const sellPricePerUnit = Math.floor(basePrice * 0.5);

  if (sellPricePerUnit <= 0) {
    return {
      ok: false,
      message: "[vendor] That item has no resale value.",
    };
  }

  // Remove items as an all-or-nothing cost
  const ok = tryConsumeItems(char, [
    { itemId, quantity: qty } as SimpleItemStack,
  ]);

  if (!ok) {
    return {
      ok: false,
      message: "[vendor] You do not have enough of that item to sell.",
    };
  }

  const goldGain = sellPricePerUnit * qty;
  giveGold(char, goldGain);

  return {
    ok: true,
    message: `[vendor] You sell ${qty}x ${itemId} for ${goldGain} gold.`,
    itemId,
    quantity: qty,
    goldGained: goldGain,
  };
}
