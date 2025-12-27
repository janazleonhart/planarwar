// worldcore/progression/rewards/grantTaskRewards.ts

import { Logger } from "../../utils/logger";
import type { CharacterState } from "../../characters/CharacterTypes";
import {
  grantReward,
  SimpleItemStack,
} from "../../economy/EconomyHelpers";

const log = Logger.scope("Rewards");

export type RewardsContext = {
  characters?: {
    grantXp(
      userId: string,
      charId: string,
      amount: number
    ): Promise<CharacterState | null>;

    // Optional: if available, let us persist inventory/currency changes
    patchCharacter?(
      userId: string,
      charId: string,
      patch: Partial<CharacterState>
    ): Promise<CharacterState | null | void>;
  };
  // Optional: if the caller wants us to update their session cache.
  session?: {
    character?: CharacterState | null;
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

  // 2) Grant gold + items via EconomyHelpers
  const itemStacks: SimpleItemStack[] = [];
  for (const [itemId, quantity] of itemAccum.entries()) {
    itemStacks.push({ itemId, quantity });
  }

  if (totalGold > 0 || itemStacks.length > 0) {
    try {
      const rewardResult = grantReward(workingChar, {
        gold: totalGold,
        items: itemStacks,
      });

      if (totalGold > 0) {
        msgs.push(
          `[progress] You receive ${totalGold} gold for completing task(s).`
        );
      }

      if (rewardResult.applied.length > 0) {
        const parts = rewardResult.applied.map(
          (s) => `${s.quantity}x ${s.itemId}`
        );
        msgs.push(`[progress] You receive: ${parts.join(", ")}.`);
      }

      if (rewardResult.failed.length > 0) {
        log.warn("Some task reward items could not be delivered", {
          charId: workingChar.id,
          failed: rewardResult.failed,
        });
        msgs.push(
          "[progress] Your bags are full; some reward items could not be delivered."
        );
      }

      // Persist inventory/currency if the caller supports it
      if (ctx.characters.patchCharacter) {
        try {
          await ctx.characters.patchCharacter(
            workingChar.userId,
            workingChar.id,
            {
              // inventory holds both bags + currency
              inventory: workingChar.inventory,
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
      log.warn("Failed to apply task item/gold rewards", {
        err: String(err),
        charId: workingChar.id,
        totalGold,
        items: itemStacks,
      });
    }
  }

  return msgs;
}
