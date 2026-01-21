// worldcore/mud/commands/progression/rewardCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState, PendingRewardEntry, PendingRewardItem } from "../../../characters/CharacterTypes";

import { ensureProgression } from "../../../progression/ProgressionCore";
import { claimPendingRewards } from "../../../rewards/RewardDelivery";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

export async function handleRewardCommand(
  ctx: MudContext,
  char: CharacterState,
  args: string[],
): Promise<string> {
  const sub = (args?.[0] ?? "").toLowerCase();
  const prog: any = ensureProgression(char);

  // pending rewards live in progression.pendingRewards (not character root)
  const pending = ((prog.pendingRewards ??= []) as unknown) as PendingRewardEntry[];

  if (!sub || sub === "help") {
    const n = pending.length;
    return [
      `[reward] Pending rewards: ${n}.`,
      "Usage: reward list | reward claim [all|N]",
    ].join("\n");
  }

  if (sub === "list") {
    if (pending.length === 0) return "[reward] You have no pending rewards.";

    const lines: string[] = [];
    lines.push(`[reward] Pending rewards (${pending.length}):`);

    const max = Math.min(pending.length, 10);
    for (let i = 0; i < max; i++) {
      const r = pending[i];

      const items = (((r as any).items ?? []) as PendingRewardItem[])
        .slice(0, 6)
        .map((it: PendingRewardItem) => `${it.qty}x ${it.itemId}`)
        .join(", ");

      const source = s((r as any).source) || "rewards";
      const note = s((r as any).note) || "";

      lines.push(
        `- #${i + 1} ${source}${note ? ` (${note})` : ""}: ${items}${
          (((r as any).items?.length ?? 0) as number) > 6 ? ", ..." : ""
        }`,
      );
    }

    if (pending.length > max) {
      lines.push(
        `[reward] Showing first ${max}. Use 'reward claim all' to attempt everything.`,
      );
    }

    return lines.join("\n");
  }

  if (sub === "claim") {
    if (pending.length === 0) return "[reward] You have no pending rewards to claim.";

    const how = (args?.[1] ?? "").toLowerCase();
    const maxEntries =
      how === "all" || how === "" ? 9999 : Math.max(1, toInt(how, 1));

    const res = await claimPendingRewards(
      {
        items: (ctx as any).items,
        mail: (ctx as any).mail,
        session: (ctx as any).session,
      },
      char,
      char.inventory,
      maxEntries,
    );

    // Persist changes
    if ((ctx as any).characters?.patchCharacter) {
      await (ctx as any).characters.patchCharacter(char.userId, char.id, {
        inventory: char.inventory,
        progression: char.progression,
      });
    }

    if (res.claimedEntries === 0) {
      return "[reward] Could not claim any rewards. Clear bag space (or enable mail) and try again.";
    }

    const got = res.claimedItems.map((x: { qty: number; itemId: string }) => `${x.qty}x ${x.itemId}`);
    const mailed = res.mailedItems.map((x: { qty: number; itemId: string }) => `${x.qty}x ${x.itemId}`);

    const lines: string[] = [];
    lines.push(
      `[reward] Claimed ${res.claimedEntries} reward entr${
        res.claimedEntries === 1 ? "y" : "ies"
      }.`,
    );
    if (got.length > 0) lines.push(`[reward] Added to bags: ${got.join(", ")}.`);
    if (mailed.length > 0) lines.push(`[reward] Mailed: ${mailed.join(", ")}.`);

    if (res.stillQueued > 0) {
      lines.push(
        `[reward] Still queued: ${res.stillQueued} entr${
          res.stillQueued === 1 ? "y" : "ies"
        }.`,
      );
    } else {
      lines.push("[reward] All pending rewards cleared.");
    }

    return lines.join("\n");
  }

  return [
    `[reward] Unknown subcommand '${s(sub)}'.`,
    "Usage: reward list | reward claim [all|N]",
  ].join("\n");
}
