// worldcore/progression/rewards/grantTaskRewards.ts

import { Logger } from "../../utils/logger";
import type { CharacterState } from "../../characters/CharacterTypes";
import { grantReward, SimpleItemStack } from "../../economy/EconomyHelpers";
import {
  deliverRewardItemsNeverDrop,
} from "../../rewards/RewardDelivery";

const log = Logger.scope("Rewards");

export type RewardsContext = {
  characters?: {
    grantXp(
      userId: string,
      charId: string,
      amount: number
    ): Promise<CharacterState | null>;

    // Optional: if available, let us persist inventory/currency/progression changes
    patchCharacter?(
      userId: string,
      charId: string,
      patch: Partial<CharacterState>
    ): Promise<CharacterState | null | void>;
  };

  // Optional: if the caller wants us to update their session cache.
  session?: {
    character?: CharacterState | null;
    identity?: { userId: string };
  };

  // Optional: enables DB-backed item resolution for stacking rules.
  items?: any;

  // Optional: enables overflow-to-mail for task rewards.
  mail?: {
    sendSystemMail(
      ownerId: string,
      ownerKind: "account" | "character" | "guild",
      subject: string,
      body: string,
      attachments: { itemId: string; qty: number; meta?: any }[]
    ): Promise<void>;
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
        const prev = itemAccum.get(it.itemId) ?? 0;
        itemAccum.set(it.itemId, prev + it.quantity);
      }
    }
  }

  // If literally nothing to grant, bail early
  if (totalXp <= 0 && totalGold <= 0 && itemAccum.size === 0) {
    return msgs;
  }

  // We'll apply rewards on this working character (XP first, then items/gold)
  let workingChar: CharacterState = char;

  // 1) Grant XP in one batch
  if (totalXp > 0) {
    try {
      const updated = await ctx.characters.grantXp(
        char.userId,
        char.id,
        totalXp
      );
      if (updated) {
        workingChar = updated;
        if (ctx.session) ctx.session.character = updated;
      }
      msgs.push(
        `[progress] You gain ${totalXp} XP for completing task(s).`
      );
    } catch (err) {
      log.warn("Failed to grant task XP", {
        err: String(err),
        charId: char.id,
        totalXp,
      });
    }
  }

  // 2) Grant gold immediately (safe) via EconomyHelpers
  if (totalGold > 0) {
    try {
      const rewardResult = grantReward(workingChar, { gold: totalGold, items: [] });
      if (rewardResult.goldGranted > 0) {
        msgs.push(
          `[progress] You receive ${rewardResult.goldGranted} gold for completing task(s).`
        );
      }
    } catch (err) {
      log.warn("Failed to grant task gold", {
        err: String(err),
        charId: workingChar.id,
        totalGold,
      });
    }
  }

  // 3) Deliver items via never-drop delivery
  const itemStacks: SimpleItemStack[] = [];
  for (const [itemId, quantity] of itemAccum.entries()) {
    itemStacks.push({ itemId, quantity });
  }

  if (itemStacks.length > 0) {
    try {
      const res = await deliverRewardItemsNeverDrop(
        { items: ctx.items, mail: ctx.mail, session: ctx.session },
        workingChar,
        workingChar.inventory,
        itemStacks.map((s) => ({ itemId: s.itemId, qty: s.quantity })),
        {
          source: "task rewards",
          note: "queued because bags/mail could not deliver immediately",
          ownerId: ctx.session?.identity?.userId,
          ownerKind: "account",
          mailSubject: "Task rewards",
          mailBody: "Your bags were full while receiving task rewards.\nExtra items were delivered to your mailbox.",
        }
      );

      const got = [...res.deliveredToBags, ...res.mailed];
      if (got.length > 0) {
        const parts = got.map((s) => `${s.qty}x ${s.itemId}`);
        msgs.push(`[progress] You receive: ${parts.join(", ")}.`);
      }

      if (res.queued.length > 0) {
        // Keep the original warning line intact (tests may be strict about it).
        msgs.push(
          "[progress] Your bags are full; some reward items could not be delivered."
        );
        msgs.push(
          "[progress] Those items were queued. Use 'reward claim' after clearing space."
        );
      }

      // Persist inventory + progression if the caller supports it
      if (ctx.characters.patchCharacter) {
        try {
          await ctx.characters.patchCharacter(
            workingChar.userId,
            workingChar.id,
            {
              inventory: workingChar.inventory,
              progression: workingChar.progression,
            }
          );
        } catch (err) {
          log.warn("Failed to patch character after task rewards", {
            err: String(err),
            charId: workingChar.id,
          });
        }
      }
    } catch (err) {
      log.warn("Failed to apply task item rewards", {
        err: String(err),
        charId: workingChar.id,
        items: itemStacks,
      });
    }
  }

  return msgs;
}
