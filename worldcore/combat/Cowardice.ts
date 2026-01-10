// worldcore/combat/Cowardice.ts
//
// Centralized cowardice / risk-mode logic.
//
// Responsibilities:
// - Interpret CharacterState.progression.flags.* related to cowardice.
// - Ask RegionDanger for the current danger tier (1–5).
// - Provide the damage-taken multiplier for combat.
// - Provide a structured CowardiceInfo object + a formatted status line
//   that commands/UIs can print.
//
// NOTE: This does NOT start or stop cowardice; walktoCommand (or similar)
// owns writing flags like walktoCowardiceStacks / walktoCowardiceUntilMs.

import type { CharacterState } from "../characters/CharacterTypes";
import {
  getRegionDangerForCharacter,
  type RegionDangerTier,
} from "../world/RegionDanger";

export interface CowardiceInfo {
  enabled: boolean;          // risk-mode-ish: do we treat cowardice as active?
  stacks: number;            // current stack count (clamped)
  maxStacks: number;         // max for the current tier
  tier: number;              // 1–5, inferred from RegionDanger
  perStackPct: number;       // e.g. 0.05 = +5% per stack
  totalPct: number;          // total extra damage taken (e.g. 0.25 = +25%)
  multiplier: number;        // final scalar (1 + totalPct), clamped
  expiresAtMs: number | null;
  remainingMs: number | null;
}

/**
 * Internal helper: safely dig flags out of CharacterState.
 */
function getFlags(char: CharacterState): Record<string, unknown> {
  const anyChar: any = char as any;
  const prog = anyChar.progression || {};
  const flags = prog.flags || {};
  return flags as Record<string, unknown>;
}

/**
 * Resolve cowardice tier by delegating to RegionDanger.
 *
 * In the future, if we ever want cowardice to use a *different* mapping
 * than generic region danger, this is the one place it needs to change.
 */
export function resolveCowardiceTier(char: CharacterState): RegionDangerTier {
  return getRegionDangerForCharacter(char);
}

/**
 * Internal helper: per-tier tuning table.
 *
 * Returns FRACTIONS, not percents (0.05 = +5% per stack).
 */
function getTierConfig(tier: number): { perStack: number; maxStacks: number } {
  switch (tier) {
    case 1: // starter / hub
      return { perStack: 0.05, maxStacks: 3 }; // +5% per stack, max +15%
    case 2: // low danger
      return { perStack: 0.05, maxStacks: 5 }; // +5% per stack, max +25%
    case 3: // mid danger
      return { perStack: 0.075, maxStacks: 5 }; // +7.5% per stack, max +37.5%
    case 4: // high danger
      return { perStack: 0.1, maxStacks: 5 }; // +10% per stack, max +50%
    case 5: // lethal border
      return { perStack: 0.125, maxStacks: 5 }; // +12.5% per stack, max +62.5%
    default:
      return { perStack: 0.05, maxStacks: 3 };
  }
}

/**
 * Core multiplier used by combat: "how much extra damage should this
 * character take from cowardice right now?"
 *
 * - char undefined → 1.0
 * - zero stacks or expired → 1.0
 * - else → 1 + stacks * perStackPct, clamped (0.1–3.0)
 */
export function computeCowardiceDamageTakenMultiplier(
  char?: CharacterState,
): number {
  if (!char) return 1;

  const info = getCowardiceInfo(char);
  return info.multiplier;
}

/**
 * Compute full cowardice status for a character.
 *
 * This is the canonical place to:
 *   - interpret flags.walktoCowardiceStacks / walktoCowardiceUntilMs
 *   - resolve danger tier via RegionDanger
 *   - compute damage-taken multiplier + human-readable fields
 *
 * Commands / UI should prefer using this instead of re-implementing logic.
 */
export function getCowardiceInfo(
  char: CharacterState,
  now: number = Date.now(),
): CowardiceInfo {
  const flags = getFlags(char);
  const anyFlags: any = flags;

  const stacksRaw = Number(anyFlags.walktoCowardiceStacks ?? 0);
  const untilRaw = Number(anyFlags.walktoCowardiceUntilMs ?? 0);

  let expiresAtMs: number | null = null;
  if (Number.isFinite(untilRaw) && untilRaw > 0) {
    expiresAtMs = untilRaw;
  }

  const tier = resolveCowardiceTier(char);
  const { perStack, maxStacks } = getTierConfig(tier);

  // Clamp stacks to sane bounds
  const clampedStacks = Math.max(
    0,
    Math.min(Number.isFinite(stacksRaw) ? stacksRaw : 0, maxStacks),
  );

  // Determine whether we treat cowardice as "enabled" at all.
  //
  // Heuristic for v1:
  //   - If there's a risk-mode flag that looks truthy → enabled.
  //   - Else, if we have any non-expired stacks → enabled.
  //
  // This keeps us resilient while walktoCommand evolves; we can wire
  // walktoRiskMode into this more strictly later.
  const riskRaw =
    anyFlags.walktoRiskMode ??
    anyFlags.walktoRisk ??
    anyFlags.walkToRisk ??
    null;

  const riskFlagOn =
    typeof riskRaw === "boolean"
      ? riskRaw
      : typeof riskRaw === "string"
      ? ["on", "true", "1", "yes"].includes(riskRaw.toLowerCase())
      : typeof riskRaw === "number"
      ? riskRaw !== 0
      : false;

  let remainingMs: number | null = null;
  let nonExpiredStacks = clampedStacks;

  if (expiresAtMs !== null) {
    const diff = expiresAtMs - now;
    if (diff <= 0) {
      // Expired → treat as no stacks.
      nonExpiredStacks = 0;
      remainingMs = 0;
    } else {
      remainingMs = diff;
    }
  }

  const effectiveStacks = nonExpiredStacks;

  const enabled =
    riskFlagOn ||
    effectiveStacks > 0 ||
    // If we ever decide to show "armed but 0 stacks" as enabled:
    false;

  let totalPct = 0;
  let multiplier = 1;

  if (enabled && effectiveStacks > 0) {
    totalPct = effectiveStacks * perStack;

    multiplier = 1 + totalPct;
    if (multiplier < 0.1) multiplier = 0.1;
    if (multiplier > 3) multiplier = 3;
  } else {
    totalPct = 0;
    multiplier = 1;
  }

  return {
    enabled,
    stacks: effectiveStacks,
    maxStacks,
    tier,
    perStackPct: perStack,
    totalPct,
    multiplier,
    expiresAtMs,
    remainingMs,
  };
}

/**
 * Turn CowardiceInfo into a one-line status string suitable for printing
 * in MUD output or debugging tools.
 *
 * Example outputs:
 *   [risk:off] cowardice: none
 *   [risk:on] cowardice: 2/5 stacks (tier 3, +22.5% dmg taken, ~11s left)
 */
export function formatCowardiceStatus(info: CowardiceInfo): string {
  if (!info.enabled || info.stacks <= 0 || info.multiplier <= 1) {
    return "[risk:off] cowardice: none";
  }

  const pct = info.totalPct * 100;
  const roundedPct = Math.round(pct * 10) / 10; // one decimal

  let timePart = "";
  if (info.remainingMs !== null && info.remainingMs > 0) {
    const secs = Math.round(info.remainingMs / 1000);
    timePart = `, ~${secs}s left`;
  }

  const tierLabel = (() => {
    switch (info.tier) {
      case 1:
        return "safe";
      case 2:
        return "low";
      case 3:
        return "mid";
      case 4:
        return "high";
      case 5:
        return "lethal";
      default:
        return "unknown";
    }
  })();

  return `[risk:on] cowardice: ${info.stacks}/${info.maxStacks} stacks (tier ${info.tier} ${tierLabel}, +${roundedPct}% dmg taken${timePart})`;
}
