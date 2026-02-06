// worldcore/items/petEquipmentOps.ts
//
// Pet Equipment v1:
// - Stores pet gear under `character.progression.flags.pet.gear`.
// - Moves items between character inventory and pet gear with overflow safety.

import { Logger } from "../utils/logger";
import { getItemTemplate } from "./ItemCatalog";
import { deliverItemToBagsOrMail } from "../loot/OverflowDelivery";
import type { ItemStack, EquipmentState, CharacterState } from "../characters/CharacterTypes";

const log = Logger.scope("PetEquipOps");

export type PetEquipContext = {
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
  // Optional DB-backed item service
  itemService?: { get(id: string): any };
};

function ensurePetGear(char: CharacterState): EquipmentState {
  if (!char.progression) (char as any).progression = {};
  const prog: any = char.progression;
  if (!prog.flags) prog.flags = {};
  if (!prog.flags.pet) prog.flags.pet = {};
  if (!prog.flags.pet.gear) prog.flags.pet.gear = {};
  return prog.flags.pet.gear as EquipmentState;
}

function resolveItemSlot(ctx: PetEquipContext, itemId: string): string {
  // Prefer DB-backed item stats if present
  try {
    const def = ctx.itemService?.get?.(itemId);
    const slot = def?.slot;
    if (slot) return String(slot).toLowerCase();
  } catch {}

  const tpl = getItemTemplate(itemId);
  return String(tpl?.slot ?? "").toLowerCase();
}

export async function petEquipFirstMatchingFromBags(
  ctx: PetEquipContext,
  char: CharacterState,
  slotRaw: string
): Promise<string> {
  const slot = String(slotRaw ?? "").toLowerCase();
  if (!slot) return "Usage: pet equip <slot>";

  const userId = ctx.session.identity?.userId;
  if (!ctx.characters || !userId) return "Equipping is not available right now.";

  let foundBag = -1;
  let foundSlot = -1;
  let foundStack: ItemStack | null = null;
  let foundName: string | null = null;

  if (char.inventory?.bags) {
    outer: for (let b = 0; b < char.inventory.bags.length; b++) {
      const bag = char.inventory.bags[b];
      for (let i = 0; i < bag.size; i++) {
        const stack = bag.slots[i];
        if (!stack) continue;
        const itemSlot = resolveItemSlot(ctx, stack.itemId);
        if (itemSlot && itemSlot === slot) {
          foundBag = b;
          foundSlot = i;
          foundStack = stack;
          // Best-effort name
          const tpl = getItemTemplate(stack.itemId);
          foundName = tpl?.name ?? stack.itemId;
          break outer;
        }
      }
    }
  }

  if (!foundStack) {
    return `You have nothing suitable to equip on your pet in slot '${slot}'.`;
  }

  // Remove from bag
  char.inventory.bags[foundBag].slots[foundSlot] = null;

  const gear = ensurePetGear(char);
  const existing: ItemStack | null = (gear as any)[slot] ?? null;
  (gear as any)[slot] = foundStack;

  // Swap-out handling: return old pet gear to bags/mail
  if (existing) {
    const qty = existing.qty ?? 1;
    const res = await deliverItemToBagsOrMail(ctx as any, {
      inventory: char.inventory,
      itemId: existing.itemId,
      qty,

      ownerId: userId,
      ownerKind: "account",

      sourceVerb: "pet equipping",
      sourceName: slot,
      mailSubject: "Pet gear swap overflow",
      mailBody:
        `Your bags were full while equipping pet gear in slot '${slot}'.\n` +
        `The replaced item was delivered to your mailbox.`,

      attachmentMeta: (existing as any).meta,
      undeliveredPolicy: "keep",
    });

    if (res.added + res.mailed < qty) {
      // Revert state rather than lose items
      char.inventory.bags[foundBag].slots[foundSlot] = foundStack;
      (gear as any)[slot] = existing;

      log.warn("petEquip: aborting due to full bags and no mail for swap", {
        charId: char.id,
        slot,
        swappedOutItemId: existing.itemId,
        requestedQty: qty,
        delivered: res.added + res.mailed,
        leftover: res.leftover,
      });

      return `Your bags are full; you cannot equip that on your pet because there is no space to store the item currently in '${slot}'.`;
    }
  }

  try {
    await ctx.characters.patchCharacter(userId, char.id, {
      inventory: char.inventory,
      progression: char.progression,
    });
  } catch (err) {
    log.warn("petEquip: failed to persist character", {
      err: String(err),
      charId: char.id,
      userId,
    });
    return "Failed to save pet gear changes.";
  }

  return `You equip ${foundName ?? foundStack.itemId} on your pet (${slot}).`;
}

export async function petUnequipToBags(
  ctx: PetEquipContext,
  char: CharacterState,
  slotRaw: string
): Promise<string> {
  const slot = String(slotRaw ?? "").toLowerCase();
  if (!slot) return "Usage: pet unequip <slot>";

  const userId = ctx.session.identity?.userId;
  if (!ctx.characters || !userId) return "Unequipping is not available right now.";

  const gear = ensurePetGear(char);
  const equipped: ItemStack | null = (gear as any)[slot] ?? null;
  if (!equipped) return `Your pet has nothing equipped in slot '${slot}'.`;

  const qty = equipped.qty ?? 1;

  const res = await deliverItemToBagsOrMail(ctx as any, {
    inventory: char.inventory,
    itemId: equipped.itemId,
    qty,

    ownerId: userId,
    ownerKind: "account",

    sourceVerb: "pet unequipping",
    sourceName: slot,
    mailSubject: "Pet unequip overflow",
    mailBody:
      `Your bags were full while unequipping pet gear from slot '${slot}'.\n` +
      `The item was sent to your mailbox.`,

    attachmentMeta: (equipped as any).meta,
    undeliveredPolicy: "keep",
  });

  if (res.added + res.mailed < qty) {
    return "Your bags are full; you cannot unequip that from your pet.";
  }

  (gear as any)[slot] = null;

  try {
    await ctx.characters.patchCharacter(userId, char.id, {
      inventory: char.inventory,
      progression: char.progression,
    });
  } catch (err) {
    log.warn("petUnequip: failed to persist character", {
      err: String(err),
      charId: char.id,
      userId,
    });
    return "Failed to save pet gear changes.";
  }

  const tpl = getItemTemplate(equipped.itemId);
  const name = tpl?.name ?? equipped.itemId;
  let msg = `You unequip ${name} from your pet (${slot}).`;
  if (res.mailed > 0) msg += ` (${res.mailed}x sent to your mailbox due to full bags.)`;
  return msg;
}

export function formatPetGear(char: CharacterState): string {
  const gear = ensurePetGear(char);
  const slots = Object.keys(gear).sort();
  if (slots.length === 0) return "[pet] Your pet has no gear equipped.";

  const lines: string[] = ["[pet] Pet Gear:"];
  for (const slot of slots) {
    const stack: any = (gear as any)[slot];
    if (!stack?.itemId) continue;
    const tpl = getItemTemplate(stack.itemId);
    const name = tpl?.name ?? stack.itemId;
    lines.push(`  ${slot}: ${name}`);
  }
  if (lines.length === 1) return "[pet] Your pet has no gear equipped.";
  return lines.join("\n");
}
