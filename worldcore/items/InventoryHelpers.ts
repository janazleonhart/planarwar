// worldcore/items/InventoryHelpers.ts

import { InventoryState, ItemStack } from "../characters/CharacterTypes";

/**
 * Find the first empty slot in any bag.
 */
export function findFreeBagSlot(
  inv: InventoryState
): { bagIndex: number; slotIndex: number } | null {
  if (!inv.bags || inv.bags.length === 0) return null;

  for (let b = 0; b < inv.bags.length; b++) {
    const bag = inv.bags[b];
    for (let i = 0; i < bag.size; i++) {
      if (!bag.slots[i]) {
        return { bagIndex: b, slotIndex: i };
      }
    }
  }
  return null;
}

/** @deprecated Use ItemService.addItem */
export function addItemToInventory(
  inv: InventoryState,
  itemId: string,
  qty = 1
): boolean {
  const slot = findFreeBagSlot(inv);
  if (!slot) return false;

  const bag = inv.bags[slot.bagIndex];
  bag.slots[slot.slotIndex] = { itemId, qty } as ItemStack;
  return true;
}

/**
 * Full stack-aware add:
 *  1) fills existing stacks up to maxStack
 *  2) then uses empty slots for new stacks
 * Returns the new inventory plus how many items were actually added.
 */
 export function addItemToBags(
  inventory: InventoryState,
  itemId: string,
  qty: number,
  stackSize: number
): number {
  const bags = inventory.bags.map((bag) => ({
    ...bag,
    slots: [...bag.slots],
  }));

  let remaining = qty;

  // 1) Top up existing stacks
  if (stackSize > 1) {
    for (const bag of bags) {
      for (let i = 0; i < bag.slots.length && remaining > 0; i++) {
        const slot = bag.slots[i];
        if (!slot || slot.itemId !== itemId) continue;

        const canAdd = stackSize - slot.qty;
        if (canAdd <= 0) continue;

        const toAdd = Math.min(canAdd, remaining);
        bag.slots[i] = { ...slot, qty: slot.qty + toAdd };
        remaining -= toAdd;
      }
    }
  }

  // 2) Create new stacks
  for (const bag of bags) {
    for (let i = 0; i < bag.slots.length && remaining > 0; i++) {
      if (bag.slots[i]) continue;

      const toAdd = Math.min(stackSize, remaining);
      bag.slots[i] = {
        itemId,
        qty: toAdd,
        meta: {},
      };
      remaining -= toAdd;
    }
  }

  // Commit mutation once
  inventory.bags = bags;

  return remaining;
}

/**
 * Add currency to an inventory in-place.
 */
 export function addCurrency(
  inv: InventoryState,
  currencyId: string,
  amount: number
): void {
  if (!inv.currency) {
    inv.currency = {};
  }
  inv.currency[currencyId] = (inv.currency[currencyId] ?? 0) + amount;
}

export function getCurrency(inv: InventoryState, id: string): number {
  return (inv.currency as any)?.[id] ?? 0;
}

export function setCurrency(inv: InventoryState, id: string, value: number): void {
  if (!inv.currency) inv.currency = {};
  (inv.currency as any)[id] = value;
}

export function getGold(inv: InventoryState): number {
  return getCurrency(inv, "gold");
}

export function setGold(inv: InventoryState, value: number): void {
  setCurrency(inv, "gold", value);
}