//web-backend/gameState/gameStateProduction.ts

import { getMorphConfig } from "../config/cityTierConfig";

import type { City, BuildingProduction } from "../domain/city";
import type { ResourceKey } from "../domain/resources";
import type { PlayerState } from "../gameState";

export interface ResourceTierState {
  resourceKey: ResourceKey;
  tier: number;
  stars: number;
  totalInvested: number;
}

export function getOrInitResourceTier(
  ps: PlayerState,
  key: ResourceKey
): ResourceTierState {
  if (!ps.resourceTiers[key]) {
    ps.resourceTiers[key] = {
      resourceKey: key,
      tier: 0,
      stars: 0,
      totalInvested: 0,
    };
  }
  return ps.resourceTiers[key]!;
}

function getResourceTierMultiplier(tier: number): number {
  if (tier <= 0) return 1;
  return 1 + tier * 0.1;
}

export function applySpecializationToProduction(
  city: City,
  base: BuildingProduction
): BuildingProduction {
  const specId = city.specializationId;
  const stars = city.specializationStars ?? 0;

  if (!specId || stars <= 0) {
    return base;
  }

  const morphCfg = getMorphConfig();
  const option = morphCfg.options.find((o) => o.id === specId);
  if (!option) {
    return base;
  }

  const bonusPct = option.bonusPerStarPct ?? 0;
  if (bonusPct <= 0) {
    return base;
  }

  const mult = 1 + (stars * bonusPct) / 100;
  const scaled: BuildingProduction = { ...base };

  switch (option.resourceFocus) {
    case "food":
      if (scaled.food != null) {
        scaled.food = Math.round(scaled.food * mult);
      }
      break;
    case "materials":
      if (scaled.materials != null) {
        scaled.materials = Math.round(scaled.materials * mult);
      }
      break;
    case "wealth":
      if (scaled.wealth != null) {
        scaled.wealth = Math.round(scaled.wealth * mult);
      }
      break;
    case "mana":
      if (scaled.mana != null) {
        scaled.mana = Math.round(scaled.mana * mult);
      }
      break;
    case "knowledge":
      if (scaled.knowledge != null) {
        scaled.knowledge = Math.round(scaled.knowledge * mult);
      }
      break;
    case "unity":
      if (scaled.unity != null) {
        scaled.unity = Math.round(scaled.unity * mult);
      }
      break;
    default:
      break;
  }

  return scaled;
}

export function applyResourceTiersToProduction(
  ps: PlayerState,
  base: BuildingProduction
): BuildingProduction {
  const scaled: BuildingProduction = { ...base };
  const tiers = ps.resourceTiers;

  if (!tiers) {
    return scaled;
  }

  for (const [key, track] of Object.entries(tiers)) {
    if (!track) continue;

    const mult = getResourceTierMultiplier(track.tier);
    if (mult <= 1) continue;

    const rk = key as ResourceKey;

    switch (rk) {
      case "fish_common":
        if (scaled.food != null) {
          scaled.food = Math.round(scaled.food * mult);
        }
        break;
      case "fish_rare":
        if (scaled.wealth != null) {
          scaled.wealth = Math.round(scaled.wealth * mult);
        }
        break;
      case "herb_common":
      case "herb_rare":
        if (scaled.knowledge != null) {
          scaled.knowledge = Math.round(scaled.knowledge * mult);
        }
        break;
      case "wood_common":
      case "wood_hard":
      case "stone_common":
      case "stone_fine":
      case "ore_iron":
      case "ore_mithril":
        if (scaled.materials != null) {
          scaled.materials = Math.round(scaled.materials * mult);
        }
        break;
      case "mana_arcane":
      case "mana_primal":
      case "mana_shadow":
      case "mana_radiant":
      case "mana_ice":
      case "mana_tidal":
        if (scaled.mana != null) {
          scaled.mana = Math.round(scaled.mana * mult);
        }
        break;
      default:
        break;
    }
  }

  return scaled;
}
