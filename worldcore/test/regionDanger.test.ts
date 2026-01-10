// worldcore/world/RegionDanger.ts
//
// Region danger brain v1.
//
// Goals:
// - Provide a single source of truth for "how dangerous is this region?"
// - Start with a simple distance-from-origin ring model.
// - Add an in-memory threat score that future systems (invasions, wars,
//   roving bosses, etc.) can bump.
// - Keep API stable so we can plug in DB-backed persistence later.
//
// This module is intentionally conservative:
// - If nobody bumps threat, we fall back to distance rings.
// - Danger tier is always clamped to 1..5.

import type { CharacterState } from "../characters/CharacterTypes";

export type RegionDangerTier = 1 | 2 | 3 | 4 | 5;

export interface RegionDangerSnapshot {
  regionId: string;
  baseTier: RegionDangerTier;
  tier: RegionDangerTier;
  score: number;
  lastUpdatedMs: number | null;
  sources: string[];
}

// How many "threat points" it takes to bump danger by +1 tier.
const REGION_DANGER_SCORE_PER_TIER = 100;

// How quickly threat decays, in points per minute.
// e.g. 5 → a +1 tier bump (100 points) fades after ~20 minutes if nothing keeps it hot.
const REGION_DANGER_DECAY_PER_MIN = 5;

type InternalState = {
  score: number;
  lastUpdatedMs: number;
  sources: string[];
};

const regionState = new Map<string, InternalState>();

function clampTier(tier: number): RegionDangerTier {
  if (tier <= 1) return 1;
  if (tier >= 5) return 5;
  return tier as RegionDangerTier;
}

/**
 * v1 base danger: infer from regionId ring.
 *
 * Expected pattern:
 *   "<shardId>:<cx>,<cz>"
 * Example:
 *   "prime_shard:0,0"   → radius 0  → tier 1
 *   "prime_shard:1,-2"  → radius 2  → tier 2
 *   "prime_shard:-3,4"  → radius 4  → tier 3
 *   "prime_shard:6,5"   → radius 6  → tier 4
 *   "prime_shard:9,0"   → radius 9  → tier 5
 */
function inferBaseTierFromRegionId(regionId: string): RegionDangerTier {
  const m = /:([-0-9]+),([-0-9]+)/.exec(regionId);
  if (!m) {
    // Unknown pattern → treat as safe.
    return 1;
  }

  const cx = Number(m[1]);
  const cz = Number(m[2]);

  if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
    return 1;
  }

  const radius = Math.max(Math.abs(cx), Math.abs(cz));

  if (radius >= 8) return 5;
  if (radius >= 5) return 4;
  if (radius >= 3) return 3;
  if (radius >= 1) return 2;
  return 1;
}

/**
 * Apply time-based decay to a region's threat score.
 *
 * NOTE: Mutates `state` in place and updates lastUpdatedMs when any decay is applied.
 */
function applyDecay(state: InternalState, now: number): void {
  // If we somehow don't have a timestamp yet, nothing to decay.
  if (!Number.isFinite(state.lastUpdatedMs)) {
    state.lastUpdatedMs = now;
    return;
  }

  const elapsedMs = now - state.lastUpdatedMs;
  if (elapsedMs <= 0) {
    // Time went backwards or hasn't moved → no decay.
    return;
  }

  const elapsedMinutes = elapsedMs / 60000;
  if (elapsedMinutes <= 0) return;

  const decay = REGION_DANGER_DECAY_PER_MIN * elapsedMinutes;
  if (decay <= 0) {
    state.lastUpdatedMs = now;
    return;
  }

  state.score = Math.max(0, state.score - decay);
  state.lastUpdatedMs = now;
}

/**
 * Bump region danger score by a positive or negative amount.
 *
 * Examples of callers (future work):
 *   - Invasion engine: bumpRegionDanger(regionId, +80, "invasion:tempest");
 *   - Faction patrols: bumpRegionDanger(regionId, -10, "patrol:oathbound");
 *   - World events: bumpRegionDanger(regionId, +150, "world_event:dragon");
 */
export function bumpRegionDanger(
  regionId: string,
  amount: number,
  source?: string,
  now: number = Date.now(),
): void {
  if (!regionId) return;
  if (!Number.isFinite(amount) || amount === 0) return;

  let state = regionState.get(regionId);
  if (!state) {
    state = {
      score: 0,
      lastUpdatedMs: now,
      sources: [],
    };
    regionState.set(regionId, state);
  } else {
    applyDecay(state, now);
  }

  state.score += amount;
  if (state.score < 0) state.score = 0;

  if (source) {
    state.sources.push(source);
    // Soft cap: keep only the last 10 reasons for debugging.
    if (state.sources.length > 10) {
      state.sources = state.sources.slice(state.sources.length - 10);
    }
  }

  state.lastUpdatedMs = now;
}

/**
 * Set the region danger score directly, overwriting any prior value.
 *
 * Mostly for admin / debug tooling or "hard" world state changes.
 */
export function setRegionDangerScore(
  regionId: string,
  score: number,
  source?: string,
  now: number = Date.now(),
): void {
  if (!regionId) return;
  if (!Number.isFinite(score) || score < 0) score = 0;

  let state = regionState.get(regionId);
  if (!state) {
    state = {
      score,
      lastUpdatedMs: now,
      sources: [],
    };
    regionState.set(regionId, state);
  } else {
    // Before overwriting, we still want to decay any stale score
    // so that setting a new score from the distant past behaves well.
    applyDecay(state, now);
    state.score = score;
    state.lastUpdatedMs = now;
  }

  if (source) {
    state.sources.push(source);
    if (state.sources.length > 10) {
      state.sources = state.sources.slice(state.sources.length - 10);
    }
  }
}

/**
 * Get a full snapshot of the danger state for a region.
 *
 * This applies decay on read, then calculates:
 *   - baseTier from distance ring
 *   - extra tiers from score
 *   - final clamped tier (1..5)
 */
export function getRegionDangerSnapshotForRegionId(
  regionId: string,
  now: number = Date.now(),
): RegionDangerSnapshot {
  const baseTier = inferBaseTierFromRegionId(regionId);

  const state = regionState.get(regionId);
  if (!state) {
    return {
      regionId,
      baseTier,
      tier: baseTier,
      score: 0,
      lastUpdatedMs: null,
      sources: [],
    };
  }

  applyDecay(state, now);

  const score = state.score;

  const extraTiersRaw = score / REGION_DANGER_SCORE_PER_TIER;
  const extraTiers = Math.floor(extraTiersRaw);

  const effectiveTier = clampTier(baseTier + extraTiers);

  return {
    regionId,
    baseTier,
    tier: effectiveTier,
    score,
    lastUpdatedMs: state.lastUpdatedMs,
    sources: [...state.sources],
  };
}

/**
 * Lightweight helper when you only need the tier (most gameplay code).
 */
export function getRegionDangerForRegionId(
  regionId: string,
  now: number = Date.now(),
): RegionDangerTier {
  return getRegionDangerSnapshotForRegionId(regionId, now).tier;
}

/**
 * Get region danger for a character, based on its lastRegionId.
 *
 * If lastRegionId is missing or malformed, we treat it as shard center
 * "<shardId>:0,0" and thus tier 1.
 */
export function getRegionDangerForCharacter(
  char: CharacterState,
  now: number = Date.now(),
): RegionDangerTier {
  const anyChar: any = char as any;
  const rawRegionId = anyChar.lastRegionId;

  let regionId: string;
  if (typeof rawRegionId === "string" && rawRegionId.length > 0) {
    regionId = rawRegionId;
  } else {
    // Fallback for early characters that might not have a regionId yet.
    regionId = `${char.shardId}:0,0`;
  }

  return getRegionDangerForRegionId(regionId, now);
}

/**
 * Simple debug helper: produce a one-line description of region danger.
 */
export function debugFormatRegionDanger(
  regionId: string,
  now: number = Date.now(),
): string {
  const snap = getRegionDangerSnapshotForRegionId(regionId, now);
  return `Region ${snap.regionId}: tier ${snap.tier} (base ${snap.baseTier}), score=${snap.score.toFixed(
    1,
  )}`;
}
