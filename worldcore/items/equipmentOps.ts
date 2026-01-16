// worldcore/items/equipmentOps.ts

import { Logger } from "../utils/logger";
import { getItemTemplate } from "./ItemCatalog";
import { deliverItemToBagsOrMail } from "../loot/OverflowDelivery";
import type { ItemStack } from "../characters/CharacterTypes";

const log = Logger.scope("EquipOps");

export type EquipContext = {
  session: { identity?: { userId: string } };
  characters?: { patchCharacter(userId: string, charId: string, patch: any): Promise<any> };
  mail?: {
    sendSystemMail(
      ownerId: string,
      ownerKind: "account" | "character" | "guild",
      subject: string,
      body: string,
      attachments: Array<{ itemId: string; qty: number; meta?: any }>
    ): Promise<void>;
  };
};

export async function equipFirstMatchingFromBags(
  ctx: EquipContext,
  char: any,
  slotRaw: string
): Promise<string> {
  const slot = String(slotRaw ?? "").toLowerCase();
  if (!slot) return "Usage: equip <slot>";

  const userId = ctx.session.identity?.userId;
  if (!ctx.characters || !userId) return "Equipping is not available right now.";

  let foundBag = -1;
  let foundSlot = -1;
  let foundStack: ItemStack | null = null;
  let foundTpl: any | null = null;

  if (char.inventory?.bags) {
    outer: for (let b = 0; b < char.inventory.bags.length; b++) {
      const bag = char.inventory.bags[b];
      for (let i = 0; i < bag.size; i++) {
        const stack = bag.slots[i];
        if (!stack) continue;

        const tpl = getItemTemplate(stack.itemId);
        if (!tpl) continue;

        if (String(tpl.slot ?? "").toLowerCase() === slot) {
          foundBag = b;
          foundSlot = i;
          foundStack = stack;
          foundTpl = tpl;
          break outer;
        }
      }
    }
  }

  if (!foundStack) {
    return `You have nothing suitable to equip in slot '${slot}'.`;
  }

  // Remove from bag
  char.inventory.bags[foundBag].slots[foundSlot] = null;

  // Swap with currently equipped item (if any)  
  if (!char.equipment) {
    char.equipment = {};
  }
  
  const existing: ItemStack | null = char.equipment[slot] ?? null;
  char.equipment[slot] = foundStack;

  if (existing) {
    const qty = existing.qty ?? 1;

    const res = await deliverItemToBagsOrMail(ctx, {
      inventory: char.inventory,
      itemId: existing.itemId,
      qty,

      ownerId: userId,
      ownerKind: "account",

      sourceVerb: "equipping",
      sourceName: foundTpl?.name ?? foundStack.itemId,
      mailSubject: "Equipment swap overflow",
      mailBody: `Your bags were full while equipping an item in slot '${slot}'.\nThe replaced item was delivered to your mailbox.`,

      attachmentMeta: (existing as any).meta,
      undeliveredPolicy: "keep",
    });

    // If we could not deliver the swapped-out item anywhere (bags full and no mail),
    // abort the equip and revert state rather than silently deleting gear.
    if (res.added + res.mailed < qty) {
      // Put the new item back into its original bag slot.
      char.inventory.bags[foundBag].slots[foundSlot] = foundStack;
      // Restore the old item into the equipment slot.
      char.equipment[slot] = existing;

      // Defensive log for debugging.
      log.warn("equip: aborting due to full bags and no mail for swap", {
        charId: char.id,
        slot,
        swappedOutItemId: existing.itemId,
        requestedQty: qty,
        delivered: res.added + res.mailed,
        leftover: res.leftover,
      });

      return `Your bags are full; you cannot equip that because there is no space to store your currently equipped item in '${slot}'.`;
    }
  }

  try {
    await ctx.characters.patchCharacter(userId, char.id, {
      inventory: char.inventory,
      equipment: char.equipment,
    });
  } catch (err) {
    log.warn("equip: failed to persist character", {
      err: String(err),
      charId: char.id,
      userId,
    });
    return "Failed to save equipment changes.";
  }

  return `You equip ${foundTpl?.name ?? foundStack.itemId} in your ${slot}.`;
}

export async function unequipToBags(
  ctx: EquipContext,
  char: any,
  slotRaw: string
): Promise<string> {
  const slot = String(slotRaw ?? "").toLowerCase();
  if (!slot) return "Usage: unequip <slot>";

  const userId = ctx.session.identity?.userId;
  if (!ctx.characters || !userId) return "Unequipping is not available right now.";

  const equipped: ItemStack | null = char.equipment?.[slot] ?? null;
  if (!equipped) return `You have nothing equipped in slot '${slot}'.`;

  const qty = equipped.qty ?? 1;

  const res = await deliverItemToBagsOrMail(ctx, {
    inventory: char.inventory,
    itemId: equipped.itemId,
    qty,

    ownerId: userId,
    ownerKind: "account",

    sourceVerb: "unequipping",
    sourceName: slot,
    mailSubject: "Unequip overflow",
    mailBody: `Your bags were full while unequipping from slot '${slot}'.\nThe item was sent to your mailbox.`,

    attachmentMeta: (equipped as any).meta,
    undeliveredPolicy: "keep",
  });

  if (res.added + res.mailed < qty) {
    return "Your bags are full; you cannot unequip that.";
  }

  // Now actually unequip (even if mailed)
  if (!char.equipment) {
    char.equipment = {};
  }
  
  char.equipment[slot] = null;

  try {
    await ctx.characters.patchCharacter(userId, char.id, {
      inventory: char.inventory,
      equipment: char.equipment,
    });
  } catch (err) {
    log.warn("unequip: failed to persist character", {
      err: String(err),
      charId: char.id,
      userId,
    });
    return "Failed to save equipment changes.";
  }

  const equippedTpl = getItemTemplate(equipped.itemId);
  const name = equippedTpl?.name ?? equipped.itemId;
  let msg = `You unequip ${name} from your ${slot}.`;
  if (res.mailed > 0) msg += ` (${res.mailed}x sent to your mailbox due to full bags.)`;
  return msg;
}
