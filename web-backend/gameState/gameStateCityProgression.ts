//web-backend/gameState/gameStateCityProgression.ts

import { getMorphConfig, getTierConfig } from "../config/cityTierConfig";

import type { ResourceVector } from "../domain/resources";
import type { PlayerState } from "../gameState";

export interface TierUpCost {
  wealth: number;
  materials: number;
  knowledge: number;
  unity: number;
}

export interface TierUpResult {
  status: "ok" | "not_found" | "insufficient_resources" | "tech_locked";
  message?: string;
  newTier?: number;
  cost?: TierUpCost;
}

export interface CityMorphResult {
  status: "ok" | "not_found" | "not_eligible" | "invalid_morph";
  message?: string;
  newTier?: number;
  specializationId?: string;
  specializationStars?: number;
}

export interface CityProgressionDeps {
  getPlayerState(playerId: string): PlayerState | undefined;
  tickPlayerState(ps: PlayerState, now: Date): void;
  clampStat(v: number): number;
}

function computeTierUpCost(currentTier: number, ps: PlayerState): TierUpCost {
  const nextTier = currentTier + 1;

  const entry = getTierConfig(nextTier);

  const defaultBase: TierUpCost = {
    wealth: 200,
    materials: 180,
    knowledge: 120,
    unity: 60,
  };

  const base = entry?.baseCost ?? defaultBase;
  const baseFactor = Math.pow(1.35, nextTier - 1);

  const prestige = ps.city.specializationStars ?? 0;
  const prestigeFactor = 1 + prestige * 0.35;
  const factor = baseFactor * prestigeFactor;

  return {
    wealth: Math.round(base.wealth * factor),
    materials: Math.round(base.materials * factor),
    knowledge: Math.round(base.knowledge * factor),
    unity: Math.round(base.unity * factor),
  };
}

function checkTierUpTechRequirements(ps: PlayerState, nextTier: number): string | null {
  const entry = getTierConfig(nextTier);
  if (!entry || !entry.techRequirements || entry.techRequirements.length === 0) {
    return null;
  }

  const have = new Set(ps.researchedTechIds ?? []);
  const missing = entry.techRequirements.filter((id) => !have.has(id));

  if (missing.length === 0) return null;
  return `Tier ${nextTier} is locked. Missing tech: ${missing.join(", ")}.`;
}

function scaleResourceVector(vec: ResourceVector, factor: number): ResourceVector {
  const out: ResourceVector = {};
  for (const key of Object.keys(vec) as (keyof ResourceVector)[]) {
    const v = vec[key];
    if (typeof v === "number") {
      out[key] = Math.round(v * factor);
    }
  }
  return out;
}

export function tierUpCityForPlayer(
  deps: CityProgressionDeps,
  playerId: string,
  now: Date
): TierUpResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  deps.tickPlayerState(ps, now);

  const currentTier = ps.city.tier;
  const nextTier = currentTier + 1;
  const techMessage = checkTierUpTechRequirements(ps, nextTier);
  if (techMessage) {
    return { status: "tech_locked", message: techMessage };
  }

  const cost = computeTierUpCost(currentTier, ps);
  const r = ps.resources;
  const canPay =
    r.wealth >= cost.wealth &&
    r.materials >= cost.materials &&
    r.knowledge >= cost.knowledge &&
    r.unity >= cost.unity;

  if (!canPay) {
    return {
      status: "insufficient_resources",
      message: "Not enough resources to tier up.",
      cost,
    };
  }

  r.wealth -= cost.wealth;
  r.materials -= cost.materials;
  r.knowledge -= cost.knowledge;
  r.unity -= cost.unity;

  ps.city.tier = nextTier;
  ps.city.maxBuildingSlots += 2;
  ps.city.stats.infrastructure = deps.clampStat(ps.city.stats.infrastructure + 2);
  ps.city.stats.prosperity = deps.clampStat(ps.city.stats.prosperity + 1);
  ps.city.stats.stability = deps.clampStat(ps.city.stats.stability + 1);
  ps.storage.protectedCapacity = scaleResourceVector(ps.storage.protectedCapacity, 1.15);

  ps.eventLog.push({
    id: `evt_tierup_${Date.now()}`,
    kind: "city_tier_up",
    timestamp: now.toISOString(),
    message: `City advanced to Tier ${nextTier}.`,
  });

  return {
    status: "ok",
    newTier: nextTier,
    cost,
  };
}

export function morphCityForPlayer(
  deps: CityProgressionDeps,
  playerId: string,
  morphId: string,
  now: Date
): CityMorphResult {
  const ps = deps.getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  deps.tickPlayerState(ps, now);

  const city = ps.city;
  const morphCfg = getMorphConfig();

  if (city.tier < morphCfg.enabledFromTier) {
    return {
      status: "not_eligible",
      message: `City must reach Tier ${morphCfg.enabledFromTier} before morphing.`,
    };
  }

  const option = morphCfg.options.find((o) => o.id === morphId);
  if (!option) {
    return { status: "invalid_morph", message: "Unknown morph choice." };
  }

  const history = city.specializationStarsHistory || {};
  city.specializationStarsHistory = history;

  if (city.specializationId) {
    const currentId = city.specializationId;
    const currentStars = city.specializationStars ?? 0;
    const prevRecorded = history[currentId] ?? 0;
    history[currentId] = Math.max(prevRecorded, currentStars);
  }

  if (city.specializationId === option.id) {
    city.specializationStars = (city.specializationStars ?? 0) + 1;
  } else {
    const rememberedStars = history[option.id] ?? 0;
    city.specializationId = option.id;
    city.specializationStars = rememberedStars;
  }

  city.tier = 1;

  ps.eventLog.push({
    id: `evt_city_morph_${Date.now()}`,
    kind: "city_morph",
    timestamp: now.toISOString(),
    message: `City morphed into ${option.label} (★${city.specializationStars})`,
  });

  return {
    status: "ok",
    newTier: city.tier,
    specializationId: city.specializationId,
    specializationStars: city.specializationStars,
  };
}
