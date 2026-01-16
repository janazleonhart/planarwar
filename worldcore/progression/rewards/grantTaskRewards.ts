// worldcore/progression/rewards/grantTaskRewards.ts

import { Logger } from "../../utils/logger";
import type { CharacterState } from "../../characters/CharacterTypes";
import { giveGold } from "../../economy/EconomyHelpers";
import { deliverItemsToBagsOrMail } from "../../loot/OverflowDelivery";

const log = Logger.scope("Rewards");

export type RewardsContext = {
  characters?: {
    grantXp(userId: string, charId: string, amount: number): Promise<CharacterState | null>;

    // Optional: if available, let us persist inventory/currency changes
    patchCharacter?(userId: string, charId: string, patch: Partial<CharacterState>): Promise<CharacterState | null | void>;
  };

  // Optional; if present, we can overflow-to-mail for task rewards.
  mail?: any;

  // Optional; used by OverflowDelivery to resolve DB-backed item metadata.
  items?: any;

  // Optional: if the caller wants us to update their session cache.
  session?: {
    character?: CharacterState | null;
    identity?: { userId: string };
  };
};

export type RewardTask = {
  reward?: {
    xp?: number;
    gold?: number;
    items?: { itemId: string; quantity: number }[];
  } | null;
};

export async function grantTaskRewards(
  ctx: RewardsContext,
  char: CharacterState,
  tasks: RewardTask[]
): Promise<string[]> {
  const msgs: string[] = [];
  if (!ctx.characters || tasks.length === 0) return msgs;

  let totalXp = 0;
  let totalGold = 0;

  // Aggregate items by itemId so we don't spam stacks
  const itemAccum = new Map<string, number>();

  for (const t of tasks) {
    const r = t.reward;
    if (!r) continue;

    const xp = r.xp ?? 0;
    if (xp > 0) totalXp += xp;

    const gold = r.gold ?? 0;
    if (gold > 0) totalGold += gold;

    if (r.items) {
      for (const it of r.items) {
        if (!it.itemId || !it.quantity || it.quantity <= 0) continue;
        itemAccum.set(it.itemId, (itemAccum.get(it.itemId) ?? 0) + it.quantity);
      }
    }
  }

  if (totalXp <= 0 && totalGold <= 0 && itemAccum.size === 0) return msgs;

  let workingChar: CharacterState = char;

  // 1) Grant XP in one batch
  if (totalXp > 0) {
    try {
      const updated = await ctx.characters.grantXp(char.userId, char.id, totalXp);
      if (updated) {
        workingChar = updated;
        if (ctx.session) ctx.session.character = updated;
      }
      msgs.push(`[progress] You gain ${totalXp} XP for completing task(s).`);
    } catch (err) {
      log.warn("Failed to grant task XP", { err: String(err), charId: char.id, totalXp });
    }
  }

  // 2) Gold (no delivery risk)
  if (totalGold > 0) {
    giveGold(workingChar, totalGold);
    msgs.push(`[progress] You receive ${totalGold} gold for completing task(s).`);
  }

  // 3) Items (bags-first; overflow-to-mail if available)
  const items = Array.from(itemAccum.entries()).map(([itemId, qty]) => ({ itemId, qty }));

  if (items.length > 0) {
    const mailAvailable = !!ctx.mail;

    // If mail is unavailable, we should avoid partial delivery/drop by requiring bag fit.
    // We do a best-effort preflight using ItemService.addToInventory if present.
    if (!mailAvailable) {
      const itemService = ctx.items;
      if (!itemService || typeof itemService.addToInventory !== "function") {
        log.warn("Task reward items could not be delivered: no mail + no item service for preflight", {
          charId: workingChar.id,
          items,
        });
        msgs.push("[progress] Task reward items could not be delivered (mail unavailable). Clear bag space and contact staff if this persists.");
      } else {
        try {
          const simInv = JSON.parse(JSON.stringify(workingChar.inventory));
          for (const it of items) {
            const r = itemService.addToInventory(simInv, it.itemId, it.qty);
            if (r && typeof r.leftover === "number" && r.leftover > 0) {
              msgs.push("[progress] Your bags are full; clear space to receive task reward items.");
              // Skip delivery; do not risk partial/drop when mail is unavailable.
              // (XP/gold already granted above; items are withheld.)
              items.length = 0;
              break;
            }
          }
        } catch (err) {
          log.warn("Failed to preflight task reward items", { err: String(err), charId: workingChar.id });
        }
      }
    }

    if (items.length > 0) {
      try {
        const deliveryCtx = {
          items: ctx.items,
          mail: ctx.mail,
          session: ctx.session,
        };

        const deliver = await deliverItemsToBagsOrMail(deliveryCtx as any, {
          inventory: workingChar.inventory,
          items: items.map((it) => ({ itemId: it.itemId, qty: it.qty })),

          ownerId: workingChar.userId,
          ownerKind: "account",

          sourceVerb: "receiving",
          sourceName: "task rewards",
          mailSubject: "Task reward overflow",
          mailBody: "Your bags were full while receiving task rewards. Extra items were delivered to your mailbox.",
        });

        const appliedParts = deliver.results
          .filter((r) => r.added + r.mailed > 0)
          .map((r) => `${r.added + r.mailed}x ${r.itemId}`);

        if (appliedParts.length > 0) {
          msgs.push(`[progress] You receive: ${appliedParts.join(", ")}.`);
        }

        const undelivered = deliver.results.filter((r) => (r as any).leftover > 0);
        if (undelivered.length > 0) {
          log.warn("Some task reward items could not be delivered", {
            charId: workingChar.id,
            undelivered: undelivered.map((r) => ({ itemId: r.itemId, qty: (r as any).leftover })),
          });
          msgs.push("[progress] Some task reward items could not be delivered (bags full and mail unavailable/failed).");
        }
      } catch (err) {
        log.warn("Failed to apply task item rewards", { err: String(err), charId: workingChar.id, items });
      }
    }
  }

  // Persist inventory/currency if the caller supports it
  if (ctx.characters.patchCharacter) {
    try {
      await ctx.characters.patchCharacter(workingChar.userId, workingChar.id, {
        inventory: workingChar.inventory,
      });
    } catch (err) {
      log.warn("Failed to patch character after task rewards", { err: String(err), charId: workingChar.id });
    }
  }

  return msgs;
}
