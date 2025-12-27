// worldcore/bank/bankOps.ts

import type { BankService } from "./BankService";
import type { ItemService } from "../items/ItemService";
import type {
  CharacterState,
  InventoryState,
  ItemStack,
} from "../characters/CharacterTypes";
import { getItemTemplate } from "../items/ItemCatalog";
import type { BankOwnerRef } from "./BankTypes";
import {
  giveItemsToCharacter,
  SimpleItemStack,
  getCharacterGold,
  trySpendGold,
  giveGold,
} from "../economy/EconomyHelpers";
import {
  getBankGold,
  setBankGold,
} from "./BankEconomyHelpers";

function describeOwner(owner: BankOwnerRef): string {
  switch (owner.ownerKind) {
    case "account":
      return "your account bank";
    case "character":
      return "your character bank";
    case "guild":
      return "your guild bank";
    case "city":
      return "your city bank";
    default:
      return `${owner.ownerKind}:${owner.ownerId}`;
  }
}

export type BankOpsContext = {
  bank: BankService;
  items?: ItemService; // optional: legacy ItemCatalog fallback
};

export type AddToBankResult = {
  slots: Array<ItemStack | null>;
  added: number;
  leftover: number;
};

function metaKey(meta: any | undefined): string {
  if (meta === undefined || meta === null) return "";
  try {
    return JSON.stringify(meta);
  } catch {
    return `__unstringifiable__:${String(meta)}`;
  }
}

function getMaxStackForItem(ctx: BankOpsContext, itemId: string): number {
  const def = ctx.items?.get(itemId);
  if (def?.maxStack && def.maxStack > 0) return def.maxStack;

  const tmpl = getItemTemplate(itemId);
  if ((tmpl as any)?.maxStack && (tmpl as any).maxStack > 0) {
    return (tmpl as any).maxStack;
  }

  return 1;
}

function getDisplayName(ctx: BankOpsContext, itemId: string): string {
  const def = ctx.items?.get(itemId);
  if (def?.name) return def.name;

  const tmpl = getItemTemplate(itemId);
  if ((tmpl as any)?.name) return (tmpl as any).name;

  return itemId;
}

function isKnownItem(ctx: BankOpsContext, itemId: string): boolean {
  return (!!ctx.items && ctx.items.has(itemId)) || !!getItemTemplate(itemId);
}

/**
 * Stack into bank slots:
 * - matches by itemId + metaKey
 * - respects maxStack
 */
export function addToBankSlots(
  ctx: BankOpsContext,
  slots: Array<ItemStack | null>,
  itemId: string,
  qty: number,
  meta?: any
): AddToBankResult {
  const out = slots.slice();
  let remaining = Math.max(0, Math.floor(qty));
  if (remaining <= 0) return { slots: out, added: 0, leftover: 0 };

  const maxStack = getMaxStackForItem(ctx, itemId);
  const wantKey = metaKey(meta);

  // 1) Top off existing stacks
  if (maxStack > 1) {
    for (let i = 0; i < out.length && remaining > 0; i++) {
      const s = out[i];
      if (!s) continue;
      if (s.itemId !== itemId) continue;
      if (metaKey(s.meta) !== wantKey) continue;

      const space = maxStack - s.qty;
      if (space <= 0) continue;

      const toAdd = Math.min(space, remaining);
      s.qty += toAdd;
      remaining -= toAdd;
    }
  }

  // 2) Fill empty slots
  for (let i = 0; i < out.length && remaining > 0; i++) {
    if (out[i]) continue;

    const stackQty = maxStack > 0 ? Math.min(maxStack, remaining) : remaining;
    out[i] = { itemId, qty: stackQty, meta: meta ?? undefined };
    remaining -= stackQty;
  }

  const added = Math.max(0, Math.floor(qty) - remaining);
  return { slots: out, added, leftover: remaining };
}

export function formatBankView(
  ctx: BankOpsContext,
  owner: BankOwnerRef,
  slots: Array<ItemStack | null>,
  gold: number
): string {
  const nonEmpty = slots
    .map((s, idx) => ({ s, idx }))
    .filter((x) => x.s && x.s.qty > 0);

  const ownerLabel = describeOwner(owner);
  const header = `[bank] Bank owner: ${ownerLabel}`;
  const goldLine = `[bank] Gold: ${gold}g`;

  if (nonEmpty.length === 0) {
    return `${header}\n${goldLine}\n[bank] (empty)`;
  }

  const lines: string[] = [];
  lines.push(header);
  lines.push(goldLine);
  lines.push("[bank] Contents:");

  for (const { s, idx } of nonEmpty) {
    const stack = s!;
    const name = getDisplayName(ctx, stack.itemId);
    lines.push(`- [${idx}] ${stack.qty}x ${name}`);
  }

  return lines.join("\n");
}

/**
 * Remove qty from a specific inventory bag slot.
 * Keeps the MUD’s “exact slot” semantics.
 */
export function takeFromInventoryExactSlot(
  inv: InventoryState,
  bagIndex: number,
  slotIndex: number,
  qty: number
): { removed: number; item?: ItemStack } {
  const want = Math.max(0, Math.floor(qty));
  if (want <= 0) return { removed: 0 };

  const bag = inv.bags?.[bagIndex];
  if (!bag) return { removed: 0 };

  const slot = bag.slots?.[slotIndex];
  if (!slot || slot.qty <= 0) return { removed: 0 };

  const removed = Math.min(want, slot.qty);
  const itemCopy: ItemStack = {
    itemId: slot.itemId,
    qty: removed,
    meta: slot.meta ?? undefined,
  };

  slot.qty -= removed;
  if (slot.qty <= 0) bag.slots[slotIndex] = null;

  return { removed, item: itemCopy };
}

/**
 * Deposit from inventory into bank for {ownerKind, ownerId}.
 */
export async function bankDepositFromInventorySlot(
  ctx: BankOpsContext,
  owner: BankOwnerRef,
  character: CharacterState,
  bagIndex: number,
  slotIndex: number,
  qty: number
): Promise<string> {
  const bankState = await ctx.bank.getBank(owner.ownerId, owner.ownerKind);

  const { removed, item } = takeFromInventoryExactSlot(
    character.inventory,
    bagIndex,
    slotIndex,
    qty
  );

  if (removed <= 0 || !item) {
    return "[bank] Nothing to deposit from that slot.";
  }

  if (!isKnownItem(ctx, item.itemId)) {
    // revert back via shared economy helper
    giveItemsToCharacter(character, [
      { itemId: item.itemId, quantity: removed } as SimpleItemStack,
    ]);
    return `[bank] Cannot deposit unknown item '${item.itemId}'.`;
  }

  const r = addToBankSlots(
    ctx,
    bankState.slots,
    item.itemId,
    removed,
    item.meta
  );
  bankState.slots = r.slots;

  // If bank is full, return leftovers to inventory
  if (r.leftover > 0) {
    giveItemsToCharacter(character, [
      { itemId: item.itemId, quantity: r.leftover } as SimpleItemStack,
    ]);
  }

  await ctx.bank.saveBank(bankState);

  const name = getDisplayName(ctx, item.itemId);
  if (r.added <= 0) {
    return `[bank] Bank is full. Could not deposit ${removed}x ${name}.`;
  }
  if (r.leftover > 0) {
    return `[bank] Deposited ${r.added}x ${name}. (${r.leftover}x returned to your inventory.)`;
  }
  return `[bank] Deposited ${r.added}x ${name}.`;
}

/**
 * Withdraw from bank into inventory for {ownerKind, ownerId}.
 */
export async function bankWithdrawToInventory(
  ctx: BankOpsContext,
  owner: BankOwnerRef,
  character: CharacterState,
  bankSlotIndex: number,
  qty: number
): Promise<string> {
  const want = Math.max(0, Math.floor(qty));
  if (want <= 0) return "[bank] Quantity must be > 0.";

  const bankState = await ctx.bank.getBank(owner.ownerId, owner.ownerKind);
  const slots = bankState.slots;

  if (bankSlotIndex < 0 || bankSlotIndex >= slots.length) {
    return "[bank] Invalid bank slot index.";
  }

  const bankSlot = slots[bankSlotIndex];
  if (!bankSlot || bankSlot.qty <= 0) {
    return "[bank] That bank slot is empty.";
  }

  if (!isKnownItem(ctx, bankSlot.itemId)) {
    return `[bank] Bank contains unknown item '${bankSlot.itemId}'. (Refusing withdraw.)`;
  }

  const toMove = Math.min(want, bankSlot.qty);

  const result = giveItemsToCharacter(character, [
    { itemId: bankSlot.itemId, quantity: toMove } as SimpleItemStack,
  ]);

  const applied = result.applied.find(
    (s) => s.itemId === bankSlot.itemId
  );
  const added = applied?.quantity ?? 0;
  const leftover = toMove - added;

  if (added > 0) {
    bankSlot.qty -= added;
    if (bankSlot.qty <= 0) {
      slots[bankSlotIndex] = null;
    }
    bankState.slots = slots;
    await ctx.bank.saveBank(bankState);
  }

  const name = getDisplayName(ctx, bankSlot.itemId);

  if (added <= 0) {
    return `[bank] Your inventory is full. Could not withdraw ${toMove}x ${name}.`;
  }
  if (leftover > 0) {
    return `[bank] Withdrew ${added}x ${name}. (${leftover}x remains in your bank.)`;
  }
  return `[bank] Withdrew ${added}x ${name}.`;
}

/**
 * Convenience wrapper for MUD-style usage.
 */
export async function handleBankCommand(
  ctx: BankOpsContext,
  owner: BankOwnerRef,
  character: CharacterState,
  args: string[]
): Promise<string> {
  const sub = (args[0] ?? "show").toLowerCase();

  // bank / bank show / bank list / bank view
  if (sub === "show" || sub === "list" || sub === "view") {
    const bankState = await ctx.bank.getBank(owner.ownerId, owner.ownerKind);
    return formatBankView(
      ctx,
      owner,
      bankState.slots,
      getBankGold(bankState)
    );
  }

  // bank gold  -> show char vs bank balances
  if (sub === "gold" || sub === "balance") {
    const bankState = await ctx.bank.getBank(owner.ownerId, owner.ownerKind);
    const bankGold = getBankGold(bankState);
    const charGold = getCharacterGold(character);
    const label = describeOwner(owner);
    return `[bank] Gold: you have ${charGold}g on hand, ${bankGold}g in ${label}.`;
  }

  // bank deposit_gold <amount>
  if (sub === "deposit_gold") {
    const amountStr = args[1];
    if (!amountStr) {
      return "[bank] Usage: bank deposit_gold <amount>";
    }
    const amount = Math.floor(Number(amountStr) || 0);
    if (amount <= 0) {
      return "[bank] Amount must be > 0.";
    }

    if (!trySpendGold(character, amount)) {
      const charGold = getCharacterGold(character);
      return `[bank] You do not have enough gold. You have ${charGold}g.`;
    }

    const bankState = await ctx.bank.getBank(owner.ownerId, owner.ownerKind);
    setBankGold(bankState, getBankGold(bankState) + amount);
    await ctx.bank.saveBank(bankState);

    const label = describeOwner(owner);
    return `[bank] Deposited ${amount}g into ${label}.`
  }

  // bank withdraw_gold <amount>
  if (sub === "withdraw_gold") {
    const amountStr = args[1];
    if (!amountStr) {
      return "[bank] Usage: bank withdraw_gold <amount>";
    }
    const amount = Math.floor(Number(amountStr) || 0);
    if (amount <= 0) {
      return "[bank] Amount must be > 0.";
    }

    const bankState = await ctx.bank.getBank(owner.ownerId, owner.ownerKind);
    const bankGold = getBankGold(bankState);
    if (bankGold < amount) {
      return `[bank] Bank only has ${bankGold}g available for withdrawal.`;
    }

    setBankGold(bankState, bankGold - amount);
    await ctx.bank.saveBank(bankState);

    giveGold(character, amount);

    const label = describeOwner(owner);
    return `[bank] Withdrew ${amount}g from ${label}.`; 
  }

  // bank deposit <bag> <slot> <qty>
  if (sub === "deposit") {
    if (args.length < 4) {
      return "[bank] Usage: bank deposit <bag> <slot> <qty>";
    }
    const bag = Number(args[1]);
    const slot = Number(args[2]);
    const qty = Number(args[3]);
    if (!Number.isFinite(bag) || !Number.isFinite(slot) || !Number.isFinite(qty)) {
      return "[bank] Bag, slot, and qty must be numbers.";
    }
    return bankDepositFromInventorySlot(
      ctx,
      owner,
      character,
      bag,
      slot,
      qty
    );
  }

  // bank withdraw <bankSlot> <qty>
  if (sub === "withdraw") {
    if (args.length < 3) {
      return "[bank] Usage: bank withdraw <bankSlot> <qty>";
    }
    const bankSlot = Number(args[1]);
    const qty = Number(args[2]);
    if (!Number.isFinite(bankSlot) || !Number.isFinite(qty)) {
      return "[bank] BankSlot and qty must be numbers.";
    }
    return bankWithdrawToInventory(
      ctx,
      owner,
      character,
      bankSlot,
      qty
    );
  }

  return "[bank] Unknown subcommand. Try: bank | bank gold | bank deposit | bank withdraw | bank deposit_gold | bank withdraw_gold";
}
