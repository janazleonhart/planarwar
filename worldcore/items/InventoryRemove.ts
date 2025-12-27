//worldcore/items/InventoryRemove.ts

import { InventoryState } from "../characters/CharacterTypes";

export interface RemoveItemResult {
  removed: number;
  leftover: number; // how many we still wanted to remove
}

/**
 * Removes up to qty of itemId from bags.
 * Mutates inventory in-place.
 * Empty slots are represented as null.
 */
export function removeItemFromBags(
  inventory: InventoryState,
  itemId: string,
  qty: number
): RemoveItemResult {
  let remaining = qty;
  let removed = 0;

  for (const bag of inventory.bags) {
    for (let i = 0; i < bag.slots.length && remaining > 0; i++) {
      const slot = bag.slots[i];
      if (!slot) continue; // null
      if (slot.itemId !== itemId) continue;

      const take = Math.min(slot.qty, remaining);
      const newQty = slot.qty - take;

      removed += take;
      remaining -= take;

      if (newQty <= 0) {
        bag.slots[i] = null;
      } else {
        bag.slots[i] = { ...slot, qty: newQty };
      }
    }
  }

  return { removed, leftover: remaining };
}
