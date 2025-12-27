// worldcore/economy/EconomyHelpers.ts

import type {
    CharacterState,
    InventoryState,
    ItemStack,
  } from "../characters/CharacterTypes";
  import {
    findFreeBagSlot,
    getGold,
    setGold,
  } from "../items/InventoryHelpers";
  
  /**
   * Simple representation of "give/take this many of X".
   */
  export interface SimpleItemStack {
    itemId: string;
    quantity: number;
  }
  
  /**
   * Result of trying to add/remove items.
   */
  export interface ItemApplyResult {
    requested: SimpleItemStack[];
    applied: SimpleItemStack[];
    failed: SimpleItemStack[];
  }
  
  /**
   * Where we get the character's inventory from.
   */
  export function getCharacterInventory(char: CharacterState): InventoryState {
    return char.inventory;
  }
  
  /**
   * Gold helpers.
   */
  export function getCharacterGold(char: CharacterState): number {
    return getGold(getCharacterInventory(char));
  }
  
  export function setCharacterGold(char: CharacterState, value: number): void {
    setGold(getCharacterInventory(char), Math.max(0, value));
  }
  
  export function giveGold(char: CharacterState, amount: number): void {
    if (amount <= 0) return;
    const inv = getCharacterInventory(char);
    const cur = getGold(inv);
    setGold(inv, cur + amount);
  }
  
  export function trySpendGold(
    char: CharacterState,
    amount: number
  ): boolean {
    if (amount <= 0) return true;
    const inv = getCharacterInventory(char);
    const cur = getGold(inv);
    if (cur < amount) return false;
    setGold(inv, cur - amount);
    return true;
  }
  
  /**
   * Remove a quantity of an itemId from an InventoryState.
   * Returns how many were actually removed.
   */
  export function removeItemQuantityFromInventory(
    inv: InventoryState,
    itemId: string,
    quantity: number
  ): number {
    if (quantity <= 0) return 0;
    if (!inv.bags || inv.bags.length === 0) return 0;
  
    let remaining = quantity;
  
    for (const bag of inv.bags) {
      for (let i = 0; i < bag.slots.length && remaining > 0; i++) {
        const stack = bag.slots[i] as ItemStack | undefined;
        if (!stack) continue;
        if (stack.itemId !== itemId) continue;
  
        const take = Math.min(stack.qty, remaining);
        const newQty = stack.qty - take;
        remaining -= take;
  
        if (newQty > 0) {
          bag.slots[i] = { ...stack, qty: newQty };
        } else {
          (bag.slots as (ItemStack | null | undefined)[])[i] = undefined;
        }
      }
  
      if (remaining <= 0) break;
    }
  
    return quantity - remaining;
  }
  
  /**
   * Very simple add: just finds free slots and drops full stacks there.
   * (Stack-size-aware version can be added later if we want to honor maxStack.)
   */
  export function addItemQuantityToInventory(
    inv: InventoryState,
    itemId: string,
    quantity: number
  ): number {
    if (quantity <= 0) return 0;
    if (!inv.bags || inv.bags.length === 0) return 0;
  
    let remaining = quantity;
  
    while (remaining > 0) {
      const slot = findFreeBagSlot(inv);
      if (!slot) break;
  
      const { bagIndex, slotIndex } = slot;
      const bag = inv.bags[bagIndex];
  
      const toAdd = remaining;
      const newStack: ItemStack = {
        itemId,
        qty: toAdd,
        // meta is optional; can be filled later if needed
        meta: {},
      } as ItemStack;
  
      (bag.slots as (ItemStack | null | undefined)[])[slotIndex] = newStack;
      remaining -= toAdd;
    }
  
    return quantity - remaining;
  }
  
  /**
   * High-level: give items to a character.
   */
  export function giveItemsToCharacter(
    char: CharacterState,
    stacks: SimpleItemStack[]
  ): ItemApplyResult {
    const inv = getCharacterInventory(char);
  
    const applied: SimpleItemStack[] = [];
    const failed: SimpleItemStack[] = [];
  
    for (const s of stacks) {
      if (s.quantity <= 0) continue;
      const added = addItemQuantityToInventory(inv, s.itemId, s.quantity);
      if (added > 0) {
        applied.push({ itemId: s.itemId, quantity: added });
        if (added < s.quantity) {
          failed.push({
            itemId: s.itemId,
            quantity: s.quantity - added,
          });
        }
      } else {
        failed.push({ itemId: s.itemId, quantity: s.quantity });
      }
    }
  
    return { requested: stacks, applied, failed };
  }
  
  /**
   * High-level: take items from a character.
   */
  export function takeItemsFromCharacter(
    char: CharacterState,
    stacks: SimpleItemStack[]
  ): ItemApplyResult {
    const inv = getCharacterInventory(char);
  
    const applied: SimpleItemStack[] = [];
    const failed: SimpleItemStack[] = [];
  
    for (const s of stacks) {
      if (s.quantity <= 0) continue;
      const removed = removeItemQuantityFromInventory(
        inv,
        s.itemId,
        s.quantity
      );
      if (removed > 0) {
        applied.push({ itemId: s.itemId, quantity: removed });
        if (removed < s.quantity) {
          failed.push({
            itemId: s.itemId,
            quantity: s.quantity - removed,
          });
        }
      } else {
        failed.push({ itemId: s.itemId, quantity: s.quantity });
      }
    }
  
    return { requested: stacks, applied, failed };
  }
  
  /**
   * All-or-nothing cost in items.
   */
  export function tryConsumeItems(
    char: CharacterState,
    cost: SimpleItemStack[]
  ): boolean {
    const inv = getCharacterInventory(char);
  
    // First check availability
    for (const c of cost) {
      if (c.quantity <= 0) continue;
      let have = 0;
  
      if (!inv.bags) return false;
  
      for (const bag of inv.bags) {
        for (const slot of bag.slots) {
          const stack = slot as ItemStack | undefined;
          if (stack && stack.itemId === c.itemId) {
            have += stack.qty;
            if (have >= c.quantity) break;
          }
        }
        if (have >= c.quantity) break;
      }
  
      if (have < c.quantity) {
        return false;
      }
    }
  
    // Then actually remove
    const result = takeItemsFromCharacter(char, cost);
    return result.failed.length === 0;
  }
  
  /**
   * Combined helper: pay a gold + item cost.
   */
  export function tryPayCost(
    char: CharacterState,
    goldCost: number,
    itemCost: SimpleItemStack[] = []
  ): boolean {
    // Check gold first
    if (goldCost > 0 && getCharacterGold(char) < goldCost) {
      return false;
    }
  
    // Check item availability
    if (!tryConsumeItems(char, itemCost)) {
      return false;
    }
  
    // Spend gold
    if (goldCost > 0 && !trySpendGold(char, goldCost)) {
      return false;
    }
  
    return true;
  }
  
  /**
   * Combined helper: reward gold + items.
   */
  export function grantReward(
    char: CharacterState,
    opts: {
      gold?: number;
      items?: SimpleItemStack[];
    }
  ): ItemApplyResult & { goldGranted: number } {
    const goldAmount = opts.gold ?? 0;
    if (goldAmount > 0) {
      giveGold(char, goldAmount);
    }
  
    const stacks = opts.items ?? [];
    const itemsResult = giveItemsToCharacter(char, stacks);
  
    return {
      ...itemsResult,
      goldGranted: goldAmount,
    };
  }
  