// worldcore/mud/commands/player/effectsCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import {
  getActiveStatusEffects,
  computeCombatStatusSnapshot,
} from "../../../combat/StatusEffects";
import { getCowardiceInfo } from "../../../combat/Cowardice";

/**
 * Format a one-line cowardice summary suitable for the effects panel.
 *
 * Examples:
 *   Cowardice: none
 *   Cowardice: 2/5 stacks (tier 3 mid, +22.5% damage taken, ~11s left)
 */
function formatCowardiceLine(char: CharacterState, now: number): string {
  const info = getCowardiceInfo(char, now);

  if (!info.enabled || info.stacks <= 0 || info.multiplier <= 1) {
    return "Cowardice: none";
  }

  const pct = Math.round(info.totalPct * 1000) / 10; // one decimal

  let tierLabel: string;
  switch (info.tier) {
    case 1:
      tierLabel = "safe";
      break;
    case 2:
      tierLabel = "low";
      break;
    case 3:
      tierLabel = "mid";
      break;
    case 4:
      tierLabel = "high";
      break;
    case 5:
      tierLabel = "lethal";
      break;
    default:
      tierLabel = "unknown";
      break;
  }

  let timePart = "";
  if (info.remainingMs !== null && info.remainingMs > 0) {
    const secs = Math.round(info.remainingMs / 1000);
    timePart = `, ~${secs}s left`;
  }

  return `Cowardice: ${info.stacks}/${info.maxStacks} stacks (tier ${info.tier} ${tierLabel}, +${pct}% damage taken${timePart})`;
}

export async function handleEffectsCommand(
  _ctx: MudContext,
  char: CharacterState,
): Promise<string> {
  if (!char) {
    return "You do not have an active character.";
  }

  const now = Date.now();
  const active = getActiveStatusEffects(char, now);

  const lines: string[] = [];

  if (!active.length) {
    // Even if you have no buffs/debuffs, cowardice still shows up.
    lines.push("You have no active temporary effects.");
    lines.push("");
    lines.push(formatCowardiceLine(char, now));
    return lines.join("\n");
  }

  const status = computeCombatStatusSnapshot(char, now);

  lines.push("Active effects:");

  for (const eff of active) {
    const remainingMs = Math.max(0, eff.expiresAtMs - now);
    const remainingSec = Math.ceil(remainingMs / 1000);

    const stacks =
      eff.maxStacks && eff.maxStacks > 1 && eff.stackCount > 1
        ? ` x${eff.stackCount}`
        : "";

    const tags =
      eff.tags && eff.tags.length ? ` [${eff.tags.join(", ")}]` : "";

    lines.push(
      `- ${eff.name ?? eff.id}${stacks}${tags} (${remainingSec}s remaining)`,
    );
  }

  // Tiny summary line so you can eyeball whether buffs are actually doing something.
  const staBonusFlat = (status.attributesFlat as any).sta ?? 0;
  const staBonusPct = (status.attributesPct as any).sta ?? 0;
  const dmgPct = status.damageDealtPct ?? 0;

  const summaryParts: string[] = [];

  if (staBonusFlat || staBonusPct) {
    const pctStr =
      staBonusPct !== 0 ? `${Math.round(staBonusPct * 100)}%` : "0%";
    summaryParts.push(
      `STA bonuses: +${staBonusFlat} flat, +${pctStr}`,
    );
  }

  if (dmgPct) {
    summaryParts.push(
      `Outgoing damage: ${
        dmgPct > 0 ? "+" : ""
      }${Math.round(dmgPct * 100)}%`,
    );
  }

  if (summaryParts.length) {
    lines.push("");
    lines.push("Summary: " + summaryParts.join(" | "));
  }

  // Always end with cowardice so you can see risk-mode punishment at a glance.
  lines.push("");
  lines.push(formatCowardiceLine(char, now));

  return lines.join("\n");
}
