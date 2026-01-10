// worldcore/combat/RegionDangerAuras.ts
//
// Region danger → ambient debuff glue.
//
// This module is deliberately small:
// - It does NOT run on its own.
// - You call updateRegionDangerAuraForCharacter(char, now?) from movement / tick.
// - It reads RegionDanger tier and uses StatusEffects to keep a simple
//   "region is hot" aura on the player.
//
// v1 design:
// - Tier 1–2: no aura
// - Tier 3+: apply a small +5% damageTakenPct debuff ("Region Peril")
// - We do not hard-remove the aura; we just stop refreshing it and let
//   duration expire when danger drops below threshold.

import type { CharacterState } from "../characters/CharacterTypes";
import {
  getRegionDangerForCharacter,
  type RegionDangerTier,
} from "../world/RegionDanger";

import {
  applyStatusEffect,
  getActiveStatusEffects,
} from "./StatusEffects";

// How long the aura should last per application.
// Callers are expected to invoke updateRegionDangerAuraForCharacter
// periodically (e.g. on move or on a short tick), and this function will
// refresh the aura when nearing expiry.
const DANGER_AURA_DURATION_MS = 15_000;

// If there is already an aura with at least this much time remaining,
// we skip re-applying.
const DANGER_AURA_REFRESH_THRESHOLD_MS = 3_000;

const DANGER_AURA_ID = "region_danger_aura";

export interface RegionDangerAuraConfig {
  tierThreshold: RegionDangerTier;
  damageTakenPct: number;
}

const DEFAULT_AURA_CONFIG: RegionDangerAuraConfig = {
  tierThreshold: 3,   // ⬅️ was 4; now starts at tier 3+
  damageTakenPct: 0.05, // +5% damage taken when active
};

/**
 * Compute whether the region danger tier should grant an aura.
 *
 * Returns the damageTakenPct for the aura, or 0 if no aura should be active.
 */
export function getRegionDangerAuraStrengthForTier(
  tier: RegionDangerTier,
  config: RegionDangerAuraConfig = DEFAULT_AURA_CONFIG,
): number {
  if (tier >= config.tierThreshold) {
    return config.damageTakenPct;
  }
  return 0;
}

/**
 * Ensure the region danger aura is up-to-date for this character.
 *
 * - If region danger tier < threshold → do nothing (no aura; any existing aura
 *   will naturally expire).
 * - If tier >= threshold → ensure a single, non-stacking status effect with
 *   id `region_danger_aura` exists, extending/refeshing it as needed.
 *
 * This function is side-effectful (mutates CharacterState via StatusEffects).
 */
export function updateRegionDangerAuraForCharacter(
  char: CharacterState,
  now: number = Date.now(),
  config: RegionDangerAuraConfig = DEFAULT_AURA_CONFIG,
): void {
  const tier = getRegionDangerForCharacter(char, now);
  const strength = getRegionDangerAuraStrengthForTier(tier, config);

  if (strength <= 0) {
    // No aura for this tier. We do not actively remove any existing aura;
    // it will time out as its duration expires.
    return;
  }

  // See if we already have a region danger aura with enough time left.
  const active = getActiveStatusEffects(char, now);
  const existing = active.find((eff) => eff.id === DANGER_AURA_ID);

  if (existing) {
    const remainingMs = Math.max(0, existing.expiresAtMs - now);
    if (remainingMs > DANGER_AURA_REFRESH_THRESHOLD_MS) {
      // Aura is already present and not about to expire; leave it alone.
      return;
    }
  }

  // Apply (or refresh) the aura.
  //
  // We rely on StatusEffects' handling of:
  // - id equality for merging
  // - maxStacks=1 to prevent stacking multiplicatively
  applyStatusEffect(
    char,
    {
      id: DANGER_AURA_ID,
      sourceKind: "environment",
      sourceId: "region_danger",
      name: "Region Peril",
      durationMs: DANGER_AURA_DURATION_MS,
      maxStacks: 1,
      initialStacks: 1,
      tags: ["debuff", "region", "danger"],
      modifiers: {
        damageTakenPct: strength,
      },
    },
    now,
  );
}
