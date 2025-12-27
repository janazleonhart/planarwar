// worldcore/items/inventoryConsume.ts

import type { InventoryState } from "../characters/CharacterTypes";

export function countItemInInventory(inv: InventoryState, itemId: string): number {
  const bags = inv.bags ?? [];
  let total = 0;

  for (const bag of bags) {
    for (const slot of bag.slots) {
      if (slot && slot.itemId === itemId) total += slot.qty;
    }
  }

  return total;
}

export function consumeItemFromInventory(inv: InventoryState, itemId: string, qty: number): boolean {
  const bags = inv.bags ?? [];
  let remaining = Math.max(0, Math.floor(qty));
  if (remaining <= 0) return true;

  for (const bag of bags) {
    for (let i = 0; i < bag.slots.length && remaining > 0; i++) {
      const slot = bag.slots[i];
      if (!slot || slot.itemId !== itemId) continue;

      if (slot.qty <= remaining) {
        remaining -= slot.qty;
        bag.slots[i] = null;
      } else {
        slot.qty -= remaining;
        remaining = 0;
      }
    }
    if (remaining <= 0) break;
  }

  return remaining <= 0;
}

export function canConsumeRecipe(
  inv: InventoryState,
  inputs: Array<{ itemId: string; qty: number }>,
  count: number
): { ok: true } | { ok: false; itemId: string; need: number; have: number } {
  for (const ing of inputs) {
    const need = ing.qty * count;
    const have = countItemInInventory(inv, ing.itemId);
    if (have < need) return { ok: false, itemId: ing.itemId, need, have };
  }
  return { ok: true };
}

export function consumeRecipe(
  inv: InventoryState,
  inputs: Array<{ itemId: string; qty: number }>,
  count: number
): boolean {
  for (const ing of inputs) {
    const need = ing.qty * count;
    if (!consumeItemFromInventory(inv, ing.itemId, need)) return false;
  }
  return true;
}
