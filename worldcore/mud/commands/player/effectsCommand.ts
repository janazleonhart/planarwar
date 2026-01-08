// worldcore/mud/commands/player/effectsCommand.ts

import type { MudContext } from "../../MudContext";
import type { CharacterState } from "../../../characters/CharacterTypes";
import {
  getActiveStatusEffects,
  computeCombatStatusSnapshot,
} from "../../../combat/StatusEffects";

export async function handleEffectsCommand(
  ctx: MudContext,
  char: CharacterState,
): Promise<string> {
  if (!char) {
    return "You do not have an active character.";
  }

  const now = Date.now();
  const active = getActiveStatusEffects(char, now);

  if (!active.length) {
    return "You have no active temporary effects.";
  }

  const status = computeCombatStatusSnapshot(char, now);

  const lines: string[] = [];
  lines.push("Active effects:");

  for (const eff of active) {
    const remainingMs = Math.max(0, eff.expiresAtMs - now);
    const remainingSec = Math.ceil(remainingMs / 1000);

    const stacks =
      eff.maxStacks && eff.maxStacks > 1 && eff.stackCount > 1
        ? ` x${eff.stackCount}`
        : "";

    const tags =
      eff.tags && eff.tags.length
        ? ` [${eff.tags.join(", ")}]`
        : "";

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
    summaryParts.push(`STA bonuses: +${staBonusFlat} flat, +${pctStr}`);
  }
  if (dmgPct) {
    summaryParts.push(
      `Outgoing damage: ${dmgPct > 0 ? "+" : ""}${Math.round(
        dmgPct * 100,
      )}%`,
    );
  }

  if (summaryParts.length) {
    lines.push("");
    lines.push("Summary: " + summaryParts.join(" | "));
  }

  return lines.join("\n");
}
