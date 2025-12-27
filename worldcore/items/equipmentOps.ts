// worldcore/items/equipmentOps.ts

import { Logger } from "../utils/logger";
import { getItemTemplate } from "./ItemCatalog";
import { addItemToBags } from "./InventoryHelpers";
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
    const existingTpl = getItemTemplate(existing.itemId);
    const maxStack = existingTpl?.maxStack ?? 1;
  
    const qty = existing.qty ?? 1;
    const leftover = addItemToBags(char.inventory, existing.itemId, qty, maxStack);
  
    if (leftover > 0) {
      const userId = ctx.session.identity?.userId;
  
      // Prefer mail overflow instead of deleting items
      if (ctx.mail && userId) {
        await ctx.mail.sendSystemMail(
          userId,
          "account",
          "Equipment swap overflow",
          `Your bags were full while equipping an item in slot '${slot}'. The replaced item was mailed to you.`,
          [{ itemId: existing.itemId, qty: leftover, meta: (existing as any).meta }]
        );
      } else {
        // fallback: log (last resort)
        log.warn("equip: no space to return previously equipped item (and no mail available)", {
          charId: char.id,
          slot,
          itemId: existing.itemId,
          leftover,
        });
      }
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
  const equippedTpl = getItemTemplate(equipped.itemId);
  const maxStack = equippedTpl?.maxStack ?? 1;

  const leftover = addItemToBags(char.inventory, equipped.itemId, qty, maxStack);

  let mailed = 0;
  if (leftover > 0) {
    const userId = ctx.session.identity?.userId;

    if (ctx.mail && userId) {
      await ctx.mail.sendSystemMail(
        userId,
        "account",
        "Unequip overflow",
        `Your bags were full while unequipping from slot '${slot}'. The item was sent to your mailbox.`,
        [{ itemId: equipped.itemId, qty: leftover, meta: (equipped as any).meta }]
      );
      mailed = leftover;
    } else {
      // No mail available; keep conservative behavior
      return "Your bags are full; you cannot unequip that.";
    }
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

  const name = equippedTpl?.name ?? equipped.itemId;
  let msg = `You unequip ${name} from your ${slot}.`;
  if (mailed > 0) msg += ` (${mailed}x sent to your mailbox due to full bags.)`;
  return msg;
}
