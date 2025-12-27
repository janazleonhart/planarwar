//backend/src/gameState.ts

import { seedWorld } from "./domain/world";
import { seedStarterCity, getCityProductionPerTick } from "./domain/city";
import { seedStarterHeroes } from "./domain/heroes";
import { seedStarterArmies } from "./domain/armies";
import { generateMissionOffers } from "./domain/missions";
import { getAvailableTechsForPlayer, getTechById } from "./domain/tech";
import { addResources } from "./domain/resources";
import {
  tickConfig,
  startingResourcesConfig,
  missionDurationConfig,
} from "./config";
import { getTierConfig, getMorphConfig } from "./config/cityTierConfig";

import type { World, RegionId } from "./domain/world";
import type { City, BuildingProduction } from "./domain/city";
import type { Hero, HeroRole } from "./domain/heroes";
import type { Army, ArmyType } from "./domain/armies";
import type {
  MissionOffer,
  MissionDifficulty,
  RewardBundle,
} from "./domain/missions";
import type { TechDefinition, TechAge, TechEpoch, TechCategory } from "./domain/tech";
import type { ResourceKey, ResourceVector } from "./domain/resources";


// ---- helpers ----

function clampStat(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

// ---- Policies ----

export interface PoliciesState {
  highTaxes: boolean;
  openTrade: boolean;
  conscription: boolean;
  arcaneFreedom: boolean;
}

export const defaultPolicies: PoliciesState = {
  highTaxes: false,
  openTrade: false,
  conscription: false,
  arcaneFreedom: false,
};

export interface Resources {
  food: number;
  materials: number;
  wealth: number;
  mana: number;
  knowledge: number;
  unity: number;
}

export interface ActiveMission {
  instanceId: string;
  mission: MissionOffer;
  startedAt: string;
  finishesAt: string;
  assignedHeroId?: string;
  assignedArmyId?: string;
}

// ---- Research state ----

export interface ActiveResearch {
  techId: string;
  progress: number;
  startedAt: string;
}

// ---- Warfront / region war state ----

export interface RegionWarState {
  regionId: RegionId;
  control: number; // 0-100 : your grip on the region
  threat: number; // 0-100 : hostile presence / chaos
}

// ---- City stress / unrest ----

export type CityStressStage = "stable" | "strained" | "crisis" | "lockdown";

export interface CityStressState {
  stage: CityStressStage;
  total: number; // 0–100 overall stress score
  foodPressure: number;   // 0–100
  threatPressure: number; // 0–100
  unityPressure: number;  // 0–100
  lastUpdatedAt: string;
}

// ---- Event log ----

export type GameEventKind =
  | "mission_start"
  | "mission_complete"
  | "tech_start"
  | "tech_complete"
  | "army_raised"
  | "army_reinforced"
  | "building_constructed"
  | "building_upgraded"
  | "hero_geared"
  | "hero_recruited"
  | "workshop_start"
  | "workshop_complete"
  | "city_stress_change"
  | "mission_refresh_region"
  | "city_tier_up"
  | "city_morph"
  | "resource_tier_up";

export interface GameEvent {
  id: string;
  timestamp: string;
  kind: GameEventKind;
  message: string;
  techId?: string;
  missionId?: string;
  armyId?: string;
  heroId?: string;
  regionId?: RegionId;
  outcome?: "success" | "partial" | "failure";
}

// ---- Player state ----

export interface PlayerState {
  playerId: string;
  city: City;
  heroes: Hero[];
  armies: Army[];
  // in gameState.ts, inside PlayerState
  resources: Resources;

  // 🔹 long-term store: real breakdown
  stockpile: ResourceVector;

  // 🔹 New: per-resource mastery tracks
  resourceTiers: Partial<Record<ResourceKey, ResourceTierState>>;

  currentOffers: MissionOffer[];
  activeMissions: ActiveMission[];

  policies: PoliciesState;
  lastTickAt: string; // ISO

  // Research
  researchedTechIds: string[];
  activeResearch?: ActiveResearch;

  // Per-region warfront status
  regionWar: RegionWarState[];

  // Recent operations log (newest last)
  eventLog: GameEvent[];

  // Active workshop crafting jobs
  workshopJobs: WorkshopJob[];

  // City stress / unrest
  cityStress: CityStressState;

  // 🔹 Storage: secure vs vulnerable
  storage: CityStorage;

  // Tech Related Stuff
  techAge: TechAge; // global floor for UI/AI if nothing more specific
  techEpoch: TechEpoch;
  techCategoryAges: Partial<Record<TechCategory, TechAge>>;
  techFlags: string[]; // e.g. ["BLACK_MARKET_ENABLED"] later

}

export interface GameState {
    world: World;
    players: Map<string, PlayerState>;
  }
  
  export const DEMO_PLAYER_ID = "demo_player";
  
  const { tickMs: TICK_MS, maxTicksPerRequest: MAX_TICKS_PER_REQUEST } =
    tickConfig;

// --- City State ---

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
  
    // 🔹 Prestige is per-current specialization only & Prestige penalty only from current spec’s stars
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

  function checkTierUpTechRequirements(
    ps: PlayerState,
    nextTier: number
  ): string | null {
    const entry = getTierConfig(nextTier);
    if (!entry || !entry.techRequirements || entry.techRequirements.length === 0) {
      return null;
    }
  
    const have = new Set(ps.researchedTechIds ?? []);
    const missing = entry.techRequirements.filter((id) => !have.has(id));
  
    if (missing.length === 0) return null;
  
    // You can make this prettier, but this works for now.
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
    playerId: string,
    now: Date
  ): TierUpResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
      return { status: "not_found", message: "Player not found" };
    }
  
    // Make sure we’re not skipping ticks
    tickPlayerState(ps, now);
  
    const currentTier = ps.city.tier;
    const nextTier = currentTier + 1;
  
    // Check tech requirements
    const techMessage = checkTierUpTechRequirements(ps, nextTier);
    if (techMessage) {
      return { status: "tech_locked", message: techMessage };
    }
  
    // Compute cost for this jump
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
  
    // Pay the cost
    r.wealth -= cost.wealth;
    r.materials -= cost.materials;
    r.knowledge -= cost.knowledge;
    r.unity -= cost.unity;
  
    // Actually tier up the city
    ps.city.tier = nextTier;
    ps.city.maxBuildingSlots += 2;
  
    // Small stat bumps so it feels tangible
    ps.city.stats.infrastructure = clampStat(ps.city.stats.infrastructure + 2);
    ps.city.stats.prosperity = clampStat(ps.city.stats.prosperity + 1);
    ps.city.stats.stability = clampStat(ps.city.stats.stability + 1);
  
    // Raise protected capacity so more stock can be “safe”
    ps.storage.protectedCapacity = scaleResourceVector(
      ps.storage.protectedCapacity,
      1.15
    );
  
    // Optional: log an event so the ops log shows it
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

  export interface CityMorphResult {
    status: "ok" | "not_found" | "not_eligible" | "invalid_morph";
    message?: string;
    newTier?: number;
    specializationId?: string;
    specializationStars?: number;
  }

  export function morphCityForPlayer(
    playerId: string,
    morphId: string,
    now: Date
  ): CityMorphResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
      return { status: "not_found", message: "Player not found" };
    }
  
    tickPlayerState(ps, now);
  
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
  
    // Ensure history object exists
    const history = city.specializationStarsHistory || {};
    city.specializationStarsHistory = history;
  
    // 🔹 Persist current spec’s stars into history before changing
    if (city.specializationId) {
      const currentId = city.specializationId;
      const currentStars = city.specializationStars ?? 0;
      const prevRecorded = history[currentId] ?? 0;
      history[currentId] = Math.max(prevRecorded, currentStars);
    }
  
    // 🔹 Same specialization: prestige loop → increment stars
    if (city.specializationId === option.id) {
      city.specializationStars = (city.specializationStars ?? 0) + 1;
    } else {
      // 🔹 New specialization: restore previous stars if any, else start at 0
      const rememberedStars = history[option.id] ?? 0;
      city.specializationId = option.id;
      city.specializationStars = rememberedStars;
    }
  
    // Reset tier back to 1 (soft prestige)
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

  function applySpecializationToProduction(
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
        // future: if we add more granular types (fire mana, ancient wood), we can
        // map specializations to stockpile keys instead of the coarse stats.
        break;
    }
  
    return scaled;
  }
  
  export interface ResourceTierState {
    resourceKey: ResourceKey;
    tier: number;          // 0+; baseline is 0
    stars: number;         // prestige later, start at 0
    totalInvested: number; // total spent to reach this tier
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
    return ps.resourceTiers[key]!; // non-null, we just set it
  }
  
  function getResourceTierMultiplier(tier: number): number {
    if (tier <= 0) return 1;
    return 1 + tier * 0.1; // +10% per tier for now
  }

  function applyResourceTiersToProduction(
    ps: PlayerState,
    base: BuildingProduction
  ): BuildingProduction {
    const scaled: BuildingProduction = { ...base };
  
    const tiers = ps.resourceTiers;
    if (!tiers) return scaled;
  
    for (const [key, track] of Object.entries(tiers)) {
      if (!track) continue;
      const mult = getResourceTierMultiplier(track.tier);
      if (mult <= 1) continue;
  
      const rk = key as ResourceKey;
  
      switch (rk) {
        // fish → food / wealth
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
  
        // herbs → knowledge
        case "herb_common":
        case "herb_rare":
          if (scaled.knowledge != null) {
            scaled.knowledge = Math.round(scaled.knowledge * mult);
          }
          break;
  
        // bulk materials → materials
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
  
        // mana types → mana
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
          // leave others alone for now
          break;
      }
    }
  
    return scaled;
  }


// ---- Warfront seeding ----

function seedRegionWar(world: World, city: City): RegionWarState[] {
  const shard = world.shards[0];
  return shard.regions.map((region) => ({
    regionId: region.id,
    control: region.id === city.regionId ? 70 : 40,
    threat: region.dangerLevel * 5,
  }));
}

// ---- Game state singleton ----

const gameState: GameState = (() => {
  const world = seedWorld();

  const nowIso = new Date().toISOString();
  const playerId = DEMO_PLAYER_ID;
  const city = seedStarterCity(playerId);
  const heroes = seedStarterHeroes(playerId);
  const armies = seedStarterArmies(city.id);

  const resources: Resources = {
    food: startingResourcesConfig.food,
    materials: startingResourcesConfig.materials,
    wealth: startingResourcesConfig.wealth,
    mana: startingResourcesConfig.mana,
    knowledge: startingResourcesConfig.knowledge,
    unity: startingResourcesConfig.unity,
  };

  // 🔹 Internal multi-resource breakdown – for now just mirror the basics
  const stockpile: ResourceVector = {
    food: startingResourcesConfig.food,
    materials_generic: startingResourcesConfig.materials,
    wealth: startingResourcesConfig.wealth,
    mana_arcane: startingResourcesConfig.mana,
    knowledge: startingResourcesConfig.knowledge,
    unity: startingResourcesConfig.unity,
  };

  // 🔹 Initial city storage: treat all starting resources as secure,
  // and set capacity to that same baseline.
  // Later, storehouse buildings / tech will raise protectedCapacity,
  // and new production will overflow into vulnerableStock.
  const storage: CityStorage = {
    protectedCapacity: { ...stockpile },
    protectedStock: { ...stockpile },
    vulnerableStock: {},
  };

  const regionWar = seedRegionWar(world, city);

  const playerState: PlayerState = {
    playerId,
    city,
    heroes,
    armies,
    resources,
    stockpile,
    storage,
    resourceTiers: {},      // 🔹 start blank; we’ll lazy-init per key
    currentOffers: [],
    activeMissions: [],
    policies: { ...defaultPolicies },
    lastTickAt: nowIso,

    researchedTechIds: [],
    techAge: "wood",
    techEpoch: "genesis",
    techCategoryAges: {},    // per-category override later
    techFlags: [],           // black market / lair flags later
    regionWar,
    eventLog: [],
    workshopJobs: [],
    cityStress: {
        stage: "stable",
        total: 0,
        foodPressure: 0,
        threatPressure: 0,
        unityPressure: 0,
        lastUpdatedAt: nowIso,
      },
  };

  const players = new Map<string, PlayerState>();
  players.set(playerId, playerState);

  return {
    world,
    players,
  };
})();

const MAX_EVENT_LOG = 100;

interface GameEventInput {
  kind: GameEventKind;
  message: string;
  techId?: string;
  missionId?: string;
  armyId?: string;
  heroId?: string;
  regionId?: RegionId;
  outcome?: "success" | "partial" | "failure";
}

function pushEvent(ps: PlayerState, input: GameEventInput): void {
  const evt: GameEvent = {
    id: `evt_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    timestamp: new Date().toISOString(),
    ...input,
  };

  ps.eventLog.push(evt);
  if (ps.eventLog.length > MAX_EVENT_LOG) {
    ps.eventLog.splice(0, ps.eventLog.length - MAX_EVENT_LOG);
  }
}

// City Stress

function recomputeCityStress(ps: PlayerState, now: Date): void {
    const r = ps.resources;
    const war = ps.regionWar;
  
    // Food pressure: below 100 food starts to hurt, 0 food = 100 pressure
    const foodPressure =
      r.food >= 100
        ? 0
        : Math.min(100, Math.round(((100 - r.food) / 100) * 100));
  
    // Threat pressure: use max regional threat directly 0–100
    const maxThreat = war.reduce((m, rw) => Math.max(m, rw.threat), 0);
    const threatPressure = Math.round(maxThreat);
  
    // Unity pressure: unity below 70 hurts; 0 unity = 100 pressure, 70+ = 0
    const unityPressure =
      r.unity >= 70
        ? 0
        : Math.min(
            100,
            Math.round(((70 - r.unity) / 70) * 100)
          );
  
    // Weighted total
    const totalRaw =
      foodPressure * 0.4 + threatPressure * 0.4 + unityPressure * 0.2;
    const total = Math.round(Math.min(100, totalRaw));
  
    let stage: CityStressStage;
    if (total < 25) stage = "stable";
    else if (total < 50) stage = "strained";
    else if (total < 75) stage = "crisis";
    else stage = "lockdown";
  
    const prevStage = ps.cityStress?.stage;
  
    ps.cityStress = {
      stage,
      total,
      foodPressure,
      threatPressure,
      unityPressure,
      lastUpdatedAt: now.toISOString(),
    };
  
    if (prevStage && prevStage !== stage) {
      let msg: string;
      switch (stage) {
        case "stable":
          msg = "City tension has eased. Streets are calmer.";
          break;
        case "strained":
          msg = "The city is growing uneasy. Grumbling and rumors spread.";
          break;
        case "crisis":
          msg =
            "Crisis in the streets: unrest is rising and discipline is fraying.";
          break;
        case "lockdown":
        default:
          msg =
            "Lockdown: riots, curfews, and crackdowns are spreading through the city.";
          break;
      }
  
      pushEvent(ps, {
        kind: "city_stress_change",
        message: msg,
      });
    }
  }

export function getGameState(): GameState {
  return gameState;
}

export function getPlayerState(playerId: string): PlayerState | undefined {
  return gameState.players.get(playerId);
}

export function getDemoPlayer(): PlayerState {
  const ps = gameState.players.get(DEMO_PLAYER_ID);
  if (!ps) {
    throw new Error("Demo player state missing");
  }
  return ps;
}

// ---- Passive tick ----

function applyProductionToResources(
    ps: PlayerState,
    prod: BuildingProduction,
    ticks: number
  ): void {
    const mult = ticks;
    const res = ps.resources;
  
    const delta: ResourceVector = {};
  
    if (prod.food) {
      const v = prod.food * mult;
      res.food += v;
      delta.food = (delta.food ?? 0) + v;
    }
    if (prod.materials) {
      const v = prod.materials * mult;
      res.materials += v;
      delta.materials_generic = (delta.materials_generic ?? 0) + v;
    }
    if (prod.wealth) {
      const v = prod.wealth * mult;
      res.wealth += v;
      delta.wealth = (delta.wealth ?? 0) + v;
    }
    if (prod.mana) {
      const v = prod.mana * mult;
      res.mana += v;
      // For now, route all mana into arcane; we’ll split aspects later.
      delta.mana_arcane = (delta.mana_arcane ?? 0) + v;
    }
    if (prod.knowledge) {
      const v = prod.knowledge * mult;
      res.knowledge += v;
      delta.knowledge = (delta.knowledge ?? 0) + v;
    }
    if (prod.unity) {
      const v = prod.unity * mult;
      res.unity += v;
      delta.unity = (delta.unity ?? 0) + v;
    }
  
    if (Object.keys(delta).length > 0) {
      ps.stockpile = addResources(ps.stockpile, delta);
    }
  }

// apply policy side-effects each tick (small nudges on stats/resources)
function applyPolicyTickEffects(
  ps: PlayerState,
  prod: BuildingProduction,
  ticks: number
): void {
  const p = ps.policies;
  const s = ps.city.stats;
  const r = ps.resources;
  const mult = ticks;

  const wealthBase = prod.wealth ?? 0;
  const manaBase = prod.mana ?? 0;

  if (p.highTaxes) {
    r.wealth += Math.round(wealthBase * 0.5 * mult);
    s.stability = clampStat(s.stability - 0.2 * mult);
  }

  if (p.openTrade) {
    r.wealth += Math.round(wealthBase * 0.25 * mult);
    s.prosperity = clampStat(s.prosperity + 0.15 * mult);
  }

  if (p.conscription) {
    s.security = clampStat(s.security + 0.2 * mult);
    s.unity = clampStat(s.unity - 0.1 * mult);
  }

  if (p.arcaneFreedom) {
    r.mana += Math.round(manaBase * 0.5 * mult);
    s.arcaneSaturation = clampStat(s.arcaneSaturation + 0.2 * mult);
    s.stability = clampStat(s.stability - 0.1 * mult);
  }
}

// city growth + upkeep based on food & stability
function applyCityGrowthAndUpkeep(
    ps: PlayerState,
    prod: BuildingProduction,
    ticks: number
  ): void {
    const s = ps.city.stats;
    const r = ps.resources;
  
    if (ticks <= 0) return;
  
    const population = s.population;
  
    // Very simple model:
    // - each point of population eats 0.1 food per tick
    // - food is already being increased by prod.food in applyProductionToResources
    const consumptionPerTick = Math.max(0, population * 0.1);
    const totalConsumption = consumptionPerTick * ticks;
  
    // Subtract consumption from the global food pool
    r.food -= totalConsumption;
  
    if (r.food < 0) {
      // We have a deficit: starvation & unrest
      const deficit = -r.food;
      r.food = 0;
  
      // Turn deficit into population + stat hits (very rough)
      const popLoss = Math.floor(deficit / 10);
      if (popLoss > 0) {
        s.population = Math.max(10, s.population - popLoss);
      }
  
      s.stability = clampStat(s.stability - 0.3 * ticks);
      s.prosperity = clampStat(s.prosperity - 0.2 * ticks);
      s.unity = clampStat(s.unity - 0.2 * ticks);
    } else {
      // We are feeding everyone. If we have *consistent* surplus, grow slowly.
      // Approximate surplus: production - consumption (per tick).
      const foodOut = prod.food ?? 0;
      const surplusPerTick = foodOut - consumptionPerTick;
  
      if (surplusPerTick > 5 && s.stability > 40) {
        // gentle growth over time
        const growth = Math.floor((surplusPerTick / 10) * ticks);
        if (growth > 0) {
          s.population += growth;
          s.prosperity = clampStat(s.prosperity + 0.1 * ticks);
        }
      }
    }
  }

// research progress: use building knowledge output as "research points"
function applyResearchProgress(
  ps: PlayerState,
  prod: BuildingProduction,
  ticks: number
): void {
  if (!ps.activeResearch) return;

  const tech = getTechById(ps.activeResearch.techId);
  if (!tech) {
    // unknown tech, clear it
    ps.activeResearch = undefined;
    return;
  }

  const knowledgePerTick = prod.knowledge ?? 0;
  if (knowledgePerTick <= 0) return;

  const delta = knowledgePerTick * ticks;
  ps.activeResearch.progress += delta;

  if (ps.activeResearch.progress >= tech.cost) {
    // complete tech
    if (!ps.researchedTechIds.includes(tech.id)) {
      ps.researchedTechIds.push(tech.id);
      applyTechCompletion(ps, tech);
    }
    ps.activeResearch = undefined;
  }
}

// warfront pressure: regions get more dangerous over time if ignored
function applyWarfrontDrift(ps: PlayerState, ticks: number): void {
    if (ticks <= 0) return;
  
    // for now we just look at the first shard
    const shard = gameState.world.shards[0];
    if (!shard) return;
  
    const stats = ps.city.stats;
  
    for (const rw of ps.regionWar) {
      const region = shard.regions.find((r) => r.id === rw.regionId);
      if (!region) continue;
  
      const danger = region.dangerLevel; // 1–10
      const security = stats.security;   // 0–100
      const stability = stats.stability; // 0–100
  
      // 0..1 where 1 = very good defenses
      const defenseFactor = (security + stability) / 200;
  
      // base threat gain per tick from region danger
      const baseThreatGain = danger * 0.03 * ticks; // tweakable
      // mitigated by how secure/stable you are
      const threatGain = baseThreatGain * (1 - defenseFactor);
  
      // threat creeps up
      rw.threat = clampStat(rw.threat + threatGain);
  
      // if threat is high, you start losing control
      if (rw.threat > 60) {
        const over = rw.threat - 60;
        const controlLoss = over * 0.02 * ticks;
        rw.control = clampStat(rw.control - controlLoss);
      }
    }
  }

// simple tech effects v1 – small but tangible bonuses
function applyTechCompletion(ps: PlayerState, tech: TechDefinition): void {
    const stats = ps.city.stats;
    const res = ps.resources;
  
    switch (tech.id) {
      // --- Urban Planning chain: building slots + city resilience ---
  
      case "urban_planning_1":
        ps.city.maxBuildingSlots += 2;
        stats.infrastructure = clampStat(stats.infrastructure + 3);
        stats.prosperity = clampStat(stats.prosperity + 1);
        break;
  
      case "urban_planning_2":
        ps.city.maxBuildingSlots += 2;
        stats.infrastructure = clampStat(stats.infrastructure + 4);
        stats.prosperity = clampStat(stats.prosperity + 2);
        stats.stability = clampStat(stats.stability + 1);
        break;
  
      case "urban_planning_3":
        ps.city.maxBuildingSlots += 3;
        stats.infrastructure = clampStat(stats.infrastructure + 6);
        stats.prosperity = clampStat(stats.prosperity + 3);
        stats.stability = clampStat(stats.stability + 2);
        break;
  
      // --- Agriculture chain: more food, kinder stress ---
  
      case "advanced_agriculture_1":
        stats.prosperity = clampStat(stats.prosperity + 2);
        stats.stability = clampStat(stats.stability + 1);
        res.food += 50;
        break;
  
      case "advanced_agriculture_2":
        stats.prosperity = clampStat(stats.prosperity + 3);
        res.food += 100;
        res.unity += 10;
        break;
  
      // --- Military chain: safer city + stronger armies ---
  
      case "militia_training_1":
        stats.security = clampStat(stats.security + 4);
        stats.stability = clampStat(stats.stability + 1);
        break;
  
      case "militia_training_2":
        stats.security = clampStat(stats.security + 6);
        // small passive buff to existing armies
        ps.armies.forEach((a) => {
          a.power = Math.max(5, Math.round(a.power * 1.1));
        });
        break;
  
      default:
        break;
    }
  }

  export function tickPlayerState(ps: PlayerState, now: Date): void {
    const last = new Date(ps.lastTickAt).getTime();
    const nowTime = now.getTime();
    const diff = nowTime - last;
    if (diff <= 0) return;
  
    let ticks = Math.floor(diff / TICK_MS);
    if (ticks <= 0) return;
    if (ticks > MAX_TICKS_PER_REQUEST) {
      ticks = MAX_TICKS_PER_REQUEST;
    }
  
    // 1) compute per-tick production with city + specialization + resource tiers
    const rawProd = getCityProductionPerTick(ps.city);
    const specProd = applySpecializationToProduction(ps.city, rawProd);
    const tieredProd = applyResourceTiersToProduction(ps, specProd);
    const prodPerTick = tieredProd;
  
    // 2) base resource gain
    applyProductionToResources(ps, tieredProd, ticks);
  
    // 3) policy side-effects
    applyPolicyTickEffects(ps, tieredProd, ticks);
  
    // 4) city growth / upkeep using the final production picture
    applyCityGrowthAndUpkeep(ps, prodPerTick, ticks);
  
    // 5) regions drift over time
    applyWarfrontDrift(ps, ticks);
  
    // 6) research progress
    applyResearchProgress(ps, tieredProd, ticks);
  
    // 7) advance clock & recompute stress
    const advancedTime = last + ticks * TICK_MS;
    const advancedDate = new Date(advancedTime);
    ps.lastTickAt = advancedDate.toISOString();
  
    recomputeCityStress(ps, advancedDate);
  }

// ---- Missions / offers helpers ----

function ensureOffers(ps: PlayerState): void {
  if (!ps.currentOffers || ps.currentOffers.length === 0) {
    ps.currentOffers = generateMissionOffers({
      city: ps.city,
      heroes: ps.heroes,
      armies: ps.armies,
      regionId: ps.city.regionId,
    });
  }
}

export function getDemoPlayerWithOffers(): PlayerState {
  const ps = getDemoPlayer();
  const now = new Date();

  tickPlayerState(ps, now);
  ensureOffers(ps);

  return ps;
}

function durationMinutesForDifficulty(diff: MissionDifficulty): number {
  const cfg = missionDurationConfig;
  switch (diff) {
    case "low":
      return cfg.low;
    case "medium":
      return cfg.medium;
    case "high":
      return cfg.high;
    case "extreme":
      return cfg.extreme;
    default:
      return cfg.medium;
  }
}

// helpers to auto-pick a force

function pickHeroForMission(
  ps: PlayerState,
  mission: MissionOffer
): Hero | null {
  const idle = ps.heroes.filter((h) => h.status === "idle");
  if (idle.length === 0) return null;
  idle.sort((a, b) => b.power - a.power);
  return idle[0];
}

function pickArmyForMission(
  ps: PlayerState,
  mission: MissionOffer
): Army | null {
  const idle = ps.armies.filter((a) => a.status === "idle");
  if (idle.length === 0) return null;
  idle.sort((a, b) => b.power - a.power);
  return idle[0];
}

export function startMissionForPlayer(
  playerId: string,
  missionId: string,
  now: Date
): ActiveMission | null {
  const ps = getPlayerState(playerId);
  if (!ps) return null;

  tickPlayerState(ps, now);
  ensureOffers(ps);

  const mission = ps.currentOffers.find((m) => m.id === missionId);
  if (!mission) {
    return null;
  }

  let assignedHeroId: string | undefined;
  let assignedArmyId: string | undefined;

  if (mission.kind === "hero") {
    const hero = pickHeroForMission(ps, mission);
    if (!hero) {
      return null;
    }
    hero.status = "on_mission";
    hero.currentMissionId = missionId;
    assignedHeroId = hero.id;
  } else if (mission.kind === "army") {
    const army = pickArmyForMission(ps, mission);
    if (!army) {
      return null;
    }
    army.status = "on_mission";
    army.currentMissionId = missionId;
    assignedArmyId = army.id;
  }

  const startedAt = now.toISOString();
  const minutes = durationMinutesForDifficulty(mission.difficulty);
  const finishesAt = new Date(
    now.getTime() + minutes * 60 * 1000
  ).toISOString();

  const instanceId = `active_${Date.now()}_${Math.floor(
    Math.random() * 100000
  )}`;

  const active: ActiveMission = {
    instanceId,
    mission,
    startedAt,
    finishesAt,
    assignedHeroId,
    assignedArmyId,
  };

  ps.activeMissions.push(active);

  pushEvent(ps, {
    kind: "mission_start",
    message: `Mission started: ${mission.title}`,
    missionId: mission.id,
    heroId: assignedHeroId,
    armyId: assignedArmyId,
    regionId: mission.regionId as RegionId,
  });

  return active;
}

// ---- Region Specific Missions ----

export function regenerateRegionMissionsForPlayer(
    playerId: string,
    targetRegionId: RegionId,
    now: Date
  ): MissionOffer[] | null {
    const ps = getPlayerState(playerId);
    if (!ps) return null;
  
    // Make sure passive tick is applied first
    tickPlayerState(ps, now);
  
    // Keep offers from other regions, drop those from this region
    const remaining = ps.currentOffers.filter(
      (m) => m.regionId !== targetRegionId
    );
  
    const newOffers = generateMissionOffers({
      city: ps.city,
      heroes: ps.heroes,
      armies: ps.armies,
      // 🔹 explicitly pass the override region id
      regionId: targetRegionId,
    });
  
    ps.currentOffers = [...remaining, ...newOffers];
  
    // Optional: log an event
     pushEvent(ps, {
       kind: "mission_refresh_region",
       message: `Operations refreshed in ${targetRegionId}`,
     });
  
    return newOffers;
  }

// ---- Warfront assault missions ----

export interface WarfrontAssaultResult {
    status: "ok" | "not_found" | "no_region" | "no_forces";
    message?: string;
    activeMission?: ActiveMission;
  }
  
  function difficultyFromDanger(
    dangerLevel: number,
    threat: number
  ): MissionDifficulty {
    const score = dangerLevel * 10 + threat * 0.5; // 0–something
  
    if (score < 40) return "low";
    if (score < 80) return "medium";
    if (score < 130) return "high";
    return "extreme";
  }
  
  export function startWarfrontAssaultForPlayer(
    playerId: string,
    regionId: RegionId,
    now: Date
  ): WarfrontAssaultResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
      return { status: "not_found", message: "Player not found" };
    }
  
    // Make sure region + warfront entry exist
    const shard = gameState.world.shards[0];
    if (!shard) {
      return { status: "no_region", message: "World shard missing" };
    }
  
    const region = shard.regions.find((r) => r.id === regionId);
    if (!region) {
      return { status: "no_region", message: "Region not found" };
    }
  
    const rw = ps.regionWar.find((r) => r.regionId === regionId);
    if (!rw) {
      return {
        status: "no_region",
        message: "No warfront state for that region",
      };
    }
  
    // Advance ticks before staging
    tickPlayerState(ps, now);
  
    const difficulty = difficultyFromDanger(region.dangerLevel, rw.threat);
    const minutes = durationMinutesForDifficulty(difficulty);
  
    // Recommended power scales with danger + threat
    const recommendedPower =
      region.dangerLevel * 120 + Math.round(rw.threat * 2);
  
    const missionId = `warfront_${region.id}_${Date.now()}`;
  
    const offer: MissionOffer = {
      id: missionId,
      kind: "army",
      difficulty,
      title: `Frontline Assault: ${region.name}`,
      description: `Commit forces to push back hostile presence in ${region.name}.`,
      regionId: region.id,
      recommendedPower,
      expectedRewards: {
        materials: 40 + region.dangerLevel * 20,
        wealth: 30 + region.dangerLevel * 15,
        influence: 2 + Math.floor(region.dangerLevel * 1.5),
      },
      risk: {
        casualtyRisk:
          difficulty === "low"
            ? "Low"
            : difficulty === "medium"
            ? "Moderate"
            : difficulty === "high"
            ? "Severe"
            : "Catastrophic",
        notes:
          "Assaulting a fortified warfront. Casualties scale with enemy threat and your army strength.",
      },
    };
  
    // Pick an army and create an active mission, same style as startMissionForPlayer
    const army = pickArmyForMission(ps, offer);
    if (!army) {
      return {
        status: "no_forces",
        message: "No idle armies available to assault this region.",
      };
    }
  
    army.status = "on_mission";
    army.currentMissionId = missionId;
  
    const startedAt = now.toISOString();
    const finishesAt = new Date(
      now.getTime() + minutes * 60 * 1000
    ).toISOString();
  
    const instanceId = `active_${Date.now()}_${Math.floor(
      Math.random() * 100000
    )}`;
  
    const active: ActiveMission = {
      instanceId,
      mission: offer,
      startedAt,
      finishesAt,
      assignedArmyId: army.id,
    };
  
    ps.activeMissions.push(active);

    pushEvent(ps, {
        kind: "mission_start",
        message: `Warfront assault launched at ${region.name}`,
        missionId: offer.id,
        armyId: army.id,
        regionId: region.id,
      });
  
    return {
      status: "ok",
      activeMission: active,
    };
  }

// ---- Garrison strike missions (hero-only raids) ----

export interface GarrisonStrikeResult {
    status: "ok" | "not_found" | "no_region" | "no_hero";
    message?: string;
    activeMission?: ActiveMission;
  }
  
  export function startGarrisonStrikeForPlayer(
    playerId: string,
    regionId: RegionId,
    now: Date
  ): GarrisonStrikeResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
      return { status: "not_found", message: "Player not found" };
    }
  
    const shard = gameState.world.shards[0];
    if (!shard) {
      return { status: "no_region", message: "World shard missing" };
    }
  
    const region = shard.regions.find((r) => r.id === regionId);
    if (!region) {
      return { status: "no_region", message: "Region not found" };
    }
  
    const rw = ps.regionWar.find((r) => r.regionId === regionId);
    if (!rw) {
      return {
        status: "no_region",
        message: "No warfront state for that region",
      };
    }
  
    // Advance ticks before sending the strike
    tickPlayerState(ps, now);
  
    const difficulty = difficultyFromDanger(region.dangerLevel, rw.threat);
    const minutes = durationMinutesForDifficulty(difficulty);
  
    // Recommended power tuned a bit lower than full warfront assault
    const recommendedPower =
      region.dangerLevel * 80 + Math.round(rw.threat * 1.5);
  
    const missionId = `garrison_${region.id}_${Date.now()}`;
  
    const offer: MissionOffer = {
      id: missionId,
      kind: "hero",
      difficulty,
      title: `Lair Strike: ${region.name}`,
      description:
        "Dispatch a hero-led strike team to hit enemy lairs, caches, or lieutenants in the area.",
      regionId: region.id,
      recommendedPower,
      expectedRewards: {
        wealth: 20 + region.dangerLevel * 10,
        materials: 15 + region.dangerLevel * 8,
        mana: 5 + region.dangerLevel * 4,
        influence: 1 + Math.floor(region.dangerLevel * 0.8),
      },
      risk: {
        casualtyRisk:
          difficulty === "low"
            ? "Low"
            : difficulty === "medium"
            ? "Moderate"
            : difficulty === "high"
            ? "Severe"
            : "Catastrophic",
        heroInjuryRisk:
          difficulty === "low"
            ? "Low"
            : difficulty === "medium"
            ? "Moderate"
            : difficulty === "high"
            ? "High"
            : "Extreme",
        notes:
          "Fast-moving raid aimed at enemy lairs. High risk for lone heroes at high danger levels.",
      },
    };
  
    // For now: auto-pick best idle hero for this raid.
    const hero = pickHeroForMission(ps, offer);
    if (!hero) {
      return {
        status: "no_hero",
        message: "No idle heroes available for a garrison strike.",
      };
    }
  
    hero.status = "on_mission";
    hero.currentMissionId = missionId;
  
    const startedAt = now.toISOString();
    const finishesAt = new Date(
      now.getTime() + minutes * 60 * 1000
    ).toISOString();
  
    const instanceId = `active_${Date.now()}_${Math.floor(
      Math.random() * 100000
    )}`;
  
    const active: ActiveMission = {
      instanceId,
      mission: offer,
      startedAt,
      finishesAt,
      assignedHeroId: hero.id,
    };
  
    ps.activeMissions.push(active);

    pushEvent(ps, {
        kind: "mission_start",
        message: `Hero raid launched in ${region.name}`,
        missionId: offer.id,
        heroId: hero.id,
        regionId: region.id,
      });
  
    return {
      status: "ok",
      activeMission: active,
    };
  }

  // ---- Workshop jobs ----

export interface WorkshopJob {
    id: string;
    attachmentKind: HeroAttachmentKind;
    startedAt: string;
    finishesAt: string;
    completed: boolean;
  }
  
// ---- Mission outcome model ----

export type MissionOutcomeKind = "success" | "partial" | "failure";

export interface MissionOutcome {
  kind: MissionOutcomeKind;
  /** The computed success probability before rolling. */
  successChance: number;
  /** Raw RNG roll in [0,1). */
  roll: number;
  /** Fraction of force power lost, from 0 to 1. */
  casualtyRate: number;
  /** Optional hero injury severity for hero missions. */
  heroInjury?: "none" | "light" | "severe";
}

export interface CompleteMissionResult {
  status: "ok" | "not_found" | "not_ready";
  message?: string;
  rewards?: RewardBundle;
  resources?: Resources;
  outcome?: MissionOutcome;
}

function computeMissionOutcome(
  ps: PlayerState,
  active: ActiveMission
): MissionOutcome {
  const mission = active.mission;
  const rec = mission.recommendedPower;

  if (rec <= 0) {
    return {
      kind: "success",
      successChance: 1,
      roll: 0,
      casualtyRate: 0,
      heroInjury: "none",
    };
  }

  let power = 0;
  if (mission.kind === "hero" && active.assignedHeroId) {
    const hero = ps.heroes.find((h) => h.id === active.assignedHeroId);
    power = hero?.power ?? 0;
  } else if (mission.kind === "army" && active.assignedArmyId) {
    const army = ps.armies.find((a) => a.id === active.assignedArmyId);
    power = army?.power ?? 0;
  }

  const ratio = power > 0 ? power / rec : 0;

  let successChance: number;
  let casualtyRate: number;

  if (ratio >= 1.5) {
    successChance = 0.95;
    casualtyRate = 0.05;
  } else if (ratio >= 1.0) {
    successChance = 0.8;
    casualtyRate = 0.15;
  } else if (ratio >= 0.7) {
    successChance = 0.55;
    casualtyRate = 0.35;
  } else {
    successChance = 0.25;
    casualtyRate = 0.6;
  }

  const roll = Math.random();

  let kind: MissionOutcomeKind;
  if (roll <= successChance) {
    kind = "success";
  } else if (roll <= successChance + 0.2) {
    kind = "partial";
  } else {
    kind = "failure";
  }

  let heroInjury: MissionOutcome["heroInjury"] = "none";
  if (mission.kind === "hero") {
    if (casualtyRate > 0.5) {
      heroInjury = "severe";
    } else if (casualtyRate > 0.2) {
      heroInjury = "light";
    }
  }

  return { kind, successChance, roll, casualtyRate, heroInjury };
}

function applyMissionCasualties(
  ps: PlayerState,
  active: ActiveMission,
  outcome: MissionOutcome
): void {
  const rate = outcome.casualtyRate;

  if (active.assignedHeroId) {
    const h = ps.heroes.find((hero) => hero.id === active.assignedHeroId);
    if (h) {
      if (outcome.heroInjury === "severe") {
        h.power = Math.max(10, Math.floor(h.power * 0.5));
      } else if (outcome.heroInjury === "light") {
        h.power = Math.max(15, Math.floor(h.power * 0.8));
      }
      h.status = "idle";
      h.currentMissionId = undefined;
    }
  }

  if (active.assignedArmyId) {
    const a = ps.armies.find((army) => army.id === active.assignedArmyId);
    if (a) {
      const lost = Math.round(a.size * rate);
      a.size = Math.max(0, a.size - lost);
      a.power = Math.max(0, Math.floor(a.power * (1 - rate)));

      if (a.size === 0 || a.power === 0) {
        ps.armies = ps.armies.filter((army) => army.id !== a.id);
      } else {
        a.status = "idle";
        a.currentMissionId = undefined;
      }
    }
  }
}

function applyMissionWarImpact(
  ps: PlayerState,
  active: ActiveMission,
  outcome: MissionOutcome
): void {
  const regionId = active.mission.regionId as RegionId;
  const rw = ps.regionWar.find((r) => r.regionId === regionId);
  if (!rw) return;

  const baseDelta = active.mission.kind === "army" ? 5 : 2;

  switch (outcome.kind) {
    case "success":
      rw.control = clampStat(rw.control + baseDelta);
      rw.threat = clampStat(rw.threat - baseDelta * 0.5);
      break;
    case "partial":
      rw.control = clampStat(rw.control + baseDelta * 0.3);
      break;
    case "failure":
      rw.control = clampStat(rw.control - baseDelta * 0.5);
      rw.threat = clampStat(rw.threat + baseDelta * 0.7);
      break;
  }
}

function grantHeroXp(hero: Hero, baseAmount: number): void {
    if (baseAmount <= 0) return;
  
    // sane defaults if somehow missing
    if (!hero.level || hero.level < 1) hero.level = 1;
    if (!hero.xpToNext || hero.xpToNext < 10) hero.xpToNext = 100;
    if (hero.xp == null) hero.xp = 0;
  
    hero.xp += baseAmount;
  
    // simple escalating curve
    while (hero.xp >= hero.xpToNext) {
      hero.xp -= hero.xpToNext;
      hero.level += 1;
      hero.xpToNext = Math.round(hero.xpToNext * 1.25);
    }
  }

  function applyCasualtiesAndXp(
    ps: PlayerState,
    active: ActiveMission,
    outcome: MissionOutcome
  ): void {
    const rate = outcome.casualtyRate;
    if (rate <= 0) return;
  
    // 🔹 Army casualties
    if (active.assignedArmyId) {
      const a = ps.armies.find((x) => x.id === active.assignedArmyId);
      if (a) {
        const loss = Math.max(1, Math.round(a.size * rate));
        a.size = Math.max(1, a.size - loss);
  
        // scale power down, but not 1:1 (so they’re bruised, not erased)
        const powerMult = 1 - rate * 0.7;
        a.power = Math.max(5, Math.round(a.power * powerMult));
      }
    }
  
    // 🔹 Hero injury flavor + XP
    if (active.assignedHeroId) {
      const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
      if (h) {
        // light “wounded” flavor using tags
        if (outcome.heroInjury === "light") {
          if (!h.tags.includes("wounded")) {
            h.tags = [...h.tags, "wounded"];
          }
        } else if (outcome.heroInjury === "severe") {
          if (!h.tags.includes("wounded")) {
            h.tags = [...h.tags, "wounded"];
          }
          // small permanent power ding
          h.power = Math.max(10, Math.round(h.power * 0.9));
        }
  
        // XP reward by difficulty + outcome
        let baseXp: number;
        switch (active.mission.difficulty) {
          case "low":
            baseXp = 10;
            break;
          case "medium":
            baseXp = 20;
            break;
          case "high":
            baseXp = 35;
            break;
          case "extreme":
            baseXp = 50;
            break;
          default:
            baseXp = 20;
            break;
        }
  
        let mult = 1;
        switch (outcome.kind) {
          case "success":
            mult = 1.3;
            break;
          case "partial":
            mult = 1.0;
            break;
          case "failure":
            mult = 0.5;
            break;
        }
  
        grantHeroXp(h, Math.round(baseXp * mult));
      }
    }
  }

export function completeMissionForPlayer(
  playerId: string,
  instanceId: string,
  now: Date
): CompleteMissionResult {
  const ps = getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  tickPlayerState(ps, now);

  const index = ps.activeMissions.findIndex(
    (am) => am.instanceId === instanceId
  );
  if (index === -1) {
    return { status: "not_found", message: "Mission instance not found" };
  }

  const active = ps.activeMissions[index];
  const finishTime = new Date(active.finishesAt).getTime();
  const nowTime = now.getTime();

  if (nowTime < finishTime) {
    return {
      status: "not_ready",
      message: "Mission is still in progress",
    };
  }
    // 🔹 Resolve outcome before we clear the mission, so we can read force power.
    const outcome = resolveMissionOutcome(ps, active);

    // 🔹 Apply casualties + XP progression
    applyCasualtiesAndXp(ps, active, outcome);

    // free assigned forces
    if (active.assignedHeroId) {
        const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
        if (h) {
        h.status = "idle";
        h.currentMissionId = undefined;
        }
    }
    if (active.assignedArmyId) {
        const a = ps.armies.find((x) => x.id === active.assignedArmyId);
        if (a) {
        a.status = "idle";
        a.currentMissionId = undefined;
        }
    }

  const rewards = active.mission.expectedRewards;
  applyRewards(ps, rewards);

  // 🔹 Strategic impact on the warfront
  applyMissionImpactToRegion(ps, active.mission, outcome);

  pushEvent(ps, {
    kind: "mission_complete",
    message: `Mission ${active.mission.title}: ${outcome.kind.toUpperCase()}`,
    missionId: active.mission.id,
    heroId: active.assignedHeroId,
    armyId: active.assignedArmyId,
    regionId: active.mission.regionId as RegionId,
    outcome: outcome.kind,
  });

  ps.activeMissions.splice(index, 1);

  return {
    status: "ok",
    rewards,
    resources: ps.resources,
    outcome,
  };
}

function scaleRewards(bundle: RewardBundle, factor: number): RewardBundle {
  return {
    wealth: bundle.wealth ? Math.round(bundle.wealth * factor) : undefined,
    food: bundle.food ? Math.round(bundle.food * factor) : undefined,
    materials: bundle.materials
      ? Math.round(bundle.materials * factor)
      : undefined,
    mana: bundle.mana ? Math.round(bundle.mana * factor) : undefined,
    knowledge: bundle.knowledge
      ? Math.round(bundle.knowledge * factor)
      : undefined,
    influence: bundle.influence
      ? Math.round(bundle.influence * factor)
      : undefined,
  };
}

// ---- City storage / safety ----

export interface CityStorage {
    // Max fully-secure capacity per resource (storehouses / tech will raise this later)
    protectedCapacity: ResourceVector;
  
    // What is currently stored securely
    protectedStock: ResourceVector;
  
    // Extra pile that can be stolen / burned / corrupted
    vulnerableStock: ResourceVector;
  }

// ---- Hero XP & leveling ----

type HeroWithProgress = Hero & {
    level?: number;
    xp?: number;
  };
  
  function ensureHeroProgress(hero: HeroWithProgress): void {
    if (hero.level == null || hero.level <= 0) {
      hero.level = 1;
    }
    if (hero.xp == null || hero.xp < 0) {
      hero.xp = 0;
    }
  }
  
  function xpRewardForMission(
    difficulty: MissionDifficulty,
    outcomeKind: MissionOutcomeKind
  ): number {
    let base: number;
    switch (difficulty) {
      case "low":
        base = 10;
        break;
      case "medium":
        base = 20;
        break;
      case "high":
        base = 35;
        break;
      case "extreme":
        base = 50;
        break;
      default:
        base = 20;
        break;
    }
  
    let mult: number;
    switch (outcomeKind) {
      case "success":
        mult = 1.0;
        break;
      case "partial":
        mult = 0.5;
        break;
      case "failure":
        mult = 0.2;
        break;
      default:
        mult = 1.0;
        break;
    }
  
    return Math.round(base * mult);
  }
  
  // 🔹 Exported so the /api/me route can compute xpToNext on the wire
  export function xpToNextLevel(level: number): number {
    // Very simple curve: 20, 35, 50, 65, ...
    return 20 + level * 15;
  }
  
  function applyHeroLevelUps(hero: HeroWithProgress): void {
    ensureHeroProgress(hero);
  
    while (hero.xp! >= xpToNextLevel(hero.level!)) {
      const needed = xpToNextLevel(hero.level!);
      hero.xp! -= needed;
      hero.level! += 1;
  
      // Power bump per level — simple first pass
      const powerGain = 5 + Math.floor(hero.level! / 2);
      hero.power += powerGain;
    }
  }
  
  function awardHeroExperience(
    ps: PlayerState,
    active: ActiveMission,
    outcome: MissionOutcome
  ): void {
    if (active.mission.kind !== "hero" || !active.assignedHeroId) {
      return;
    }
  
    const hero = ps.heroes.find(
      (h) => h.id === active.assignedHeroId
    ) as HeroWithProgress | undefined;
  
    if (!hero) return;
  
    ensureHeroProgress(hero);
  
    const xpGain = xpRewardForMission(
      active.mission.difficulty,
      outcome.kind
    );
  
    hero.xp! += xpGain;
    applyHeroLevelUps(hero);
  }

  // ---- Hero gear / attachments ----

export type HeroAttachmentKind =
    | "valor_charm"
    | "scouting_cloak"
    | "arcane_focus";

   export interface HeroAttachment {
    id: string;
    kind: HeroAttachmentKind;
    name: string;
    }

    interface HeroAttachmentDef {
    name: string;
    powerBonus: number;
    wealthCost: number;
    manaCost: number;
    craftMaterialsCost: number;
    craftMinutes: number;
    }

    const HERO_ATTACHMENT_DEFS: Record<HeroAttachmentKind, HeroAttachmentDef> = {
    valor_charm: {
    name: "Valor Charm",
    powerBonus: 15,
    wealthCost: 60,
    manaCost: 0,
    craftMaterialsCost: 80,
    craftMinutes: 30,
    },
    scouting_cloak: {
    name: "Scouting Cloak",
    powerBonus: 10,
    wealthCost: 45,
    manaCost: 10,
    craftMaterialsCost: 60,
    craftMinutes: 25,
    },
    arcane_focus: {
    name: "Arcane Focus",
    powerBonus: 18,
    wealthCost: 70,
    manaCost: 25,
    craftMaterialsCost: 90,
    craftMinutes: 40,
    },
    };

    type HeroWithGear = Hero & {
    level?: number;
    xp?: number;
    attachments?: HeroAttachment[];
    };

    export interface EquipHeroAttachmentResult {
    status:
    | "ok"
    | "not_found"
    | "unknown_kind"
    | "insufficient_resources"
    | "already_has";
    message?: string;
    hero?: HeroWithGear;
    resources?: Resources;
    }

    // direct “buy & equip” path (your existing buttons)
    export function equipHeroAttachmentForPlayer(
    playerId: string,
    heroId: string,
    kind: HeroAttachmentKind,
    now: Date
    ): EquipHeroAttachmentResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
    return { status: "not_found", message: "Player not found" };
    }

    const def = HERO_ATTACHMENT_DEFS[kind];
    if (!def) {
    return { status: "unknown_kind", message: "Unknown attachment kind" };
    }

    tickPlayerState(ps, now);

    const hero = ps.heroes.find((h) => h.id === heroId) as
    | HeroWithGear
    | undefined;
    if (!hero) {
    return { status: "not_found", message: "Hero not found" };
    }

    if (!hero.attachments) {
    hero.attachments = [];
    }

    if (hero.attachments.some((a) => a.kind === kind)) {
    return {
        status: "already_has",
        message: `${def.name} is already equipped on this hero.`,
        hero,
        resources: ps.resources,
    };
    }

    const wealthCost = def.wealthCost;
    const manaCost = def.manaCost;

    if (
    ps.resources.wealth < wealthCost ||
    ps.resources.mana < manaCost
    ) {
    return {
        status: "insufficient_resources",
        message: `Need ${wealthCost} wealth and ${manaCost} mana to equip ${def.name}.`,
    };
    }

    ps.resources.wealth -= wealthCost;
    ps.resources.mana -= manaCost;

    const attachment: HeroAttachment = {
    id: `hgear_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    kind,
    name: def.name,
    };

    hero.attachments.push(attachment);
    hero.power += def.powerBonus;

    pushEvent(ps, {
    kind: "hero_geared",
    message: `Equipped ${def.name} on ${hero.name}`,
    heroId: hero.id,
    });

    return {
    status: "ok",
    hero,
    resources: ps.resources,
    };
    }

    // helper for workshop completion: pick a hero who doesn’t already have this attachment
    function pickHeroForAttachment(
    ps: PlayerState,
    kind: HeroAttachmentKind
    ): HeroWithGear | null {
    const list = ps.heroes as HeroWithGear[];
    const candidates = list.filter((h) => {
    const attachments = h.attachments ?? [];
    return !attachments.some((a) => a.kind === kind);
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.power - a.power);
    return candidates[0];
    }

    export interface StartWorkshopJobResult {
    status: "ok" | "not_found" | "unknown_kind" | "insufficient_resources";
    message?: string;
    job?: WorkshopJob;
    resources?: Resources;
    }

    export interface CompleteWorkshopJobResult {
    status:
    | "ok"
    | "not_found"
    | "not_ready"
    | "no_hero_available"
    | "already_completed";
    message?: string;
    job?: WorkshopJob;
    hero?: HeroWithGear;
    resources?: Resources;
    }

    // start a timed workshop craft job
    export function startWorkshopJobForPlayer(
    playerId: string,
    kind: HeroAttachmentKind,
    now: Date
    ): StartWorkshopJobResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
    return { status: "not_found", message: "Player not found" };
    }

    const def = HERO_ATTACHMENT_DEFS[kind];
    if (!def) {
    return {
        status: "unknown_kind",
        message: "Unknown attachment kind",
    };
    }

    tickPlayerState(ps, now);

    const r = ps.resources;

    // Workshop costs: heavier on materials, lighter on wealth
    const materialsCost = def.craftMaterialsCost;
    const wealthCost = Math.round(def.wealthCost * 0.4);
    const manaCost = def.manaCost;

    if (
    r.materials < materialsCost ||
    r.wealth < wealthCost ||
    r.mana < manaCost
    ) {
    return {
        status: "insufficient_resources",
        message: `Need ${materialsCost} materials, ${wealthCost} wealth and ${manaCost} mana to start crafting ${def.name}.`,
    };
    }

    r.materials -= materialsCost;
    r.wealth -= wealthCost;
    r.mana -= manaCost;

    const startedAt = now.toISOString();
    const finishesAt = new Date(
    now.getTime() + def.craftMinutes * 60 * 1000
    ).toISOString();

    const job: WorkshopJob = {
    id: `craft_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    attachmentKind: kind,
    startedAt,
    finishesAt,
    completed: false,
    };

    ps.workshopJobs.push(job);

    pushEvent(ps, {
    kind: "workshop_start",
    message: `Started crafting ${def.name} in the workshop.`,
    });

    return {
    status: "ok",
    job,
    resources: ps.resources,
    };
    }

    // complete a workshop job and auto-equip on a suitable hero
    export function completeWorkshopJobForPlayer(
    playerId: string,
    jobId: string,
    now: Date
    ): CompleteWorkshopJobResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
    return { status: "not_found", message: "Player not found" };
    }

    tickPlayerState(ps, now);

    const job = ps.workshopJobs.find((j) => j.id === jobId);
    if (!job) {
    return {
        status: "not_found",
        message: "Workshop job not found",
    };
    }

    if (job.completed) {
    return {
        status: "already_completed",
        message: "Job already completed.",
        job,
        resources: ps.resources,
    };
    }

    const finishTime = new Date(job.finishesAt).getTime();
    const nowTime = now.getTime();

    if (nowTime < finishTime) {
    return {
        status: "not_ready",
        message: "Crafting is still in progress.",
        job,
        resources: ps.resources,
    };
    }

    const def = HERO_ATTACHMENT_DEFS[job.attachmentKind];
    if (!def) {
    job.completed = true;
    return {
        status: "ok",
        message: "Attachment definition missing; marking job complete.",
        job,
        resources: ps.resources,
    };
    }

    const hero = pickHeroForAttachment(ps, job.attachmentKind);
    if (!hero) {
    job.completed = true;
    pushEvent(ps, {
        kind: "workshop_complete",
        message: `Crafted ${def.name}, but no suitable hero was available.`,
    });
    return {
        status: "no_hero_available",
        message: "No hero available to equip this item.",
        job,
        resources: ps.resources,
    };
    }

    if (!hero.attachments) {
    hero.attachments = [];
    }

    const attachment: HeroAttachment = {
    id: `hgear_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    kind: job.attachmentKind,
    name: def.name,
    };

    hero.attachments.push(attachment);
    hero.power += def.powerBonus;

    job.completed = true;

    pushEvent(ps, {
    kind: "hero_geared",
    message: `Workshop completed: equipped ${def.name} on ${hero.name}.`,
    heroId: hero.id,
    });
    pushEvent(ps, {
    kind: "workshop_complete",
    message: `Workshop job finished: ${def.name}.`,
    });

    return {
    status: "ok",
    job,
    hero,
    resources: ps.resources,
    };
}

// ---- Hero recruitment ----

export interface RecruitHeroResult {
    status:
      | "ok"
      | "not_found"
      | "invalid_role"
      | "insufficient_resources";
    message?: string;
    hero?: Hero;
    resources?: Resources;
  }
  
  interface HeroRecruitDef {
    namePool: string[];
    basePower: number;
    wealthCost: number;
    unityCost: number;
  }
  
  // Simple, role-based costs/power. Later this can read city tier/tech.
  const HERO_RECRUIT_DEFS: Record<HeroRole, HeroRecruitDef> = {
    champion: {
      namePool: [
        "Steelbound Vanguard",
        "The Unbroken Shield",
        "Crimson Bulwark",
        "Stormwall Captain",
      ],
      basePower: 75,
      wealthCost: 150,
      unityCost: 10,
    },
    scout: {
      namePool: [
        "Whisperstep Ranger",
        "Veiled Pathfinder",
        "Shadowrunner",
        "Silent Arrow",
      ],
      basePower: 55,
      wealthCost: 110,
      unityCost: 7,
    },
    tactician: {
      namePool: [
        "Battlefield Architect",
        "Lineshaper",
        "Warroom Savant",
        "Frontline Marshal",
      ],
      basePower: 60,
      wealthCost: 130,
      unityCost: 9,
    },
    mage: {
      namePool: [
        "Ember Sigilist",
        "Aetherbinder",
        "Stormcall Arcanist",
        "Gloamfire Occultist",
      ],
      basePower: 70,
      wealthCost: 140,
      unityCost: 8,
    },
  };
  
  function pickHeroName(role: HeroRole, index: number): string {
    const def = HERO_RECRUIT_DEFS[role];
    if (!def) return `Unknown ${role}`;
    const pool = def.namePool;
    if (pool.length === 0) return `Nameless ${role}`;
    return pool[index % pool.length];
  }
  
  export function recruitHeroForPlayer(
    playerId: string,
    role: HeroRole,
    now: Date
  ): RecruitHeroResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
      return { status: "not_found", message: "Player not found" };
    }
  
    const def = HERO_RECRUIT_DEFS[role];
    if (!def) {
      return { status: "invalid_role", message: "Invalid hero role" };
    }
  
    // advance sim first
    tickPlayerState(ps, now);
  
    const r = ps.resources;
  
    if (r.wealth < def.wealthCost || r.unity < def.unityCost) {
      return {
        status: "insufficient_resources",
        message: `Need ${def.wealthCost} wealth and ${def.unityCost} unity to recruit this hero.`,
      };
    }
  
    r.wealth -= def.wealthCost;
    r.unity -= def.unityCost;
  
    const index = ps.heroes.length + 1;
    const name = pickHeroName(role, index);
  
    // small scaling with city tier so later cities don't get wet noodles
    const tier = ps.city.tier ?? 1;
    const variance = Math.floor(Math.random() * 11) - 5; // -5..+5
    const power =
      def.basePower + tier * 5 + variance;
  
    const hero: Hero = {
      id: `hero_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      ownerId: ps.playerId,
      name,
      role,
      power,
      tags: [],
      status: "idle",
    };
  
    ps.heroes.push(hero);
  
    pushEvent(ps, {
      kind: "hero_recruited",
      message: `Recruited ${hero.name} (${hero.role})`,
      heroId: hero.id,
    });
  
    return {
      status: "ok",
      hero,
      resources: ps.resources,
    };
  }

// ---- Army recruitment & reinforcement ----

export interface RaiseArmyResult {
    status: "ok" | "not_found" | "invalid_type" | "insufficient_resources";
    message?: string;
    army?: Army;
    resources?: Resources;
  }
  
  export interface ReinforceArmyResult {
    status:
      | "ok"
      | "not_found"
      | "insufficient_resources"
      | "not_idle";
    message?: string;
    army?: Army;
    resources?: Resources;
  }
  
  const ARMY_BASE_CONFIG: Record<
    ArmyType,
    { baseSize: number; basePower: number; baseMaterials: number; baseWealth: number }
  > = {
    militia: {
      baseSize: 100,
      basePower: 60,
      baseMaterials: 80,
      baseWealth: 40,
    },
    line: {
      baseSize: 150,
      basePower: 100,
      baseMaterials: 130,
      baseWealth: 80,
    },
    vanguard: {
      baseSize: 80,
      basePower: 140,
      baseMaterials: 160,
      baseWealth: 120,
    },
  };
  
  export function raiseArmyForPlayer(
    playerId: string,
    type: ArmyType,
    now: Date
  ): RaiseArmyResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
      return { status: "not_found", message: "Player not found" };
    }
  
    const cfg = ARMY_BASE_CONFIG[type];
    if (!cfg) {
      return { status: "invalid_type", message: "Unknown army type" };
    }
  
    // advance simulation
    tickPlayerState(ps, now);
  
    const tier = ps.city.tier;
    const tierMult = 1 + (tier - 1) * 0.25;
  
    const size = Math.round(cfg.baseSize * tierMult);
    const power = Math.round(cfg.basePower * tierMult);
  
    const materialsCost = Math.round(cfg.baseMaterials * tierMult);
    const wealthCost = Math.round(cfg.baseWealth * tierMult);
  
    if (
      ps.resources.materials < materialsCost ||
      ps.resources.wealth < wealthCost
    ) {
      return {
        status: "insufficient_resources",
        message: `Need ${materialsCost} materials and ${wealthCost} wealth to raise this army.`,
      };
    }
  
    // pay the cost
    ps.resources.materials -= materialsCost;
    ps.resources.wealth -= wealthCost;
  
    const index = ps.armies.length + 1;
    const nameBase =
      type === "militia"
        ? "Militia Cohort"
        : type === "line"
        ? "Line Regiment"
        : "Vanguard Spear";
  
    const army: Army = {
      id: `army_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      cityId: ps.city.id,
      name: `${nameBase} ${index}`,
      type,
      power,
      size,
      status: "idle",
    };
  
    ps.armies.push(army);

    pushEvent(ps, {
        kind: "army_raised",
        message: `Raised ${army.name} (${army.type})`,
        armyId: army.id,
      });
  
    return {
      status: "ok",
      army,
      resources: ps.resources,
    };
  }
  
  export function reinforceArmyForPlayer(
    playerId: string,
    armyId: string,
    now: Date
  ): ReinforceArmyResult {
    const ps = getPlayerState(playerId);
    if (!ps) {
      return { status: "not_found", message: "Player not found" };
    }
  
    // advance simulation
    tickPlayerState(ps, now);
  
    const army = ps.armies.find((a) => a.id === armyId);
    if (!army) {
      return { status: "not_found", message: "Army not found" };
    }
  
    if (army.status !== "idle") {
      return {
        status: "not_idle",
        message: "Army must be idle to be reinforced.",
      };
    }
  
    // reinforcement is a % of current size, with a minimum
    const deltaSize = Math.max(30, Math.round(army.size * 0.3));
    const materialsCost = Math.round(deltaSize * 0.6); // 0.6 materials per head
    const wealthCost = Math.round(deltaSize * 0.35);   // 0.35 wealth per head
  
    if (
      ps.resources.materials < materialsCost ||
      ps.resources.wealth < wealthCost
    ) {
      return {
        status: "insufficient_resources",
        message: `Need ${materialsCost} materials and ${wealthCost} wealth to reinforce this army.`,
      };
    }
  
    // pay the cost
    ps.resources.materials -= materialsCost;
    ps.resources.wealth -= wealthCost;
  
    // buff the army
    army.size += deltaSize;
    // some of these are veterans, so power increases slightly more
    const deltaPower = Math.max(10, Math.round(army.power * 0.25));
    army.power += deltaPower;
  
    pushEvent(ps, {
        kind: "army_reinforced",
        message: `Reinforced ${army.name} by ${deltaSize} troops`,
        armyId: army.id,
      });

    return {
      status: "ok",
      army,
      resources: ps.resources,
    };
  }  

  function applyRewards(ps: PlayerState, rewards: RewardBundle): void {
    const resources = ps.resources;
    const delta: ResourceVector = {};
  
    if (rewards.food) {
      resources.food += rewards.food;
      delta.food = (delta.food ?? 0) + rewards.food;
    }
    if (rewards.materials) {
      resources.materials += rewards.materials;
      delta.materials_generic =
        (delta.materials_generic ?? 0) + rewards.materials;
    }
    if (rewards.wealth) {
      resources.wealth += rewards.wealth;
      delta.wealth = (delta.wealth ?? 0) + rewards.wealth;
    }
    if (rewards.mana) {
      resources.mana += rewards.mana;
      delta.mana_arcane = (delta.mana_arcane ?? 0) + rewards.mana;
    }
    if (rewards.knowledge) {
      resources.knowledge += rewards.knowledge;
      delta.knowledge = (delta.knowledge ?? 0) + rewards.knowledge;
    }
    if (rewards.influence) {
      resources.unity += rewards.influence;
      delta.unity = (delta.unity ?? 0) + rewards.influence;
    }
  
    if (Object.keys(delta).length > 0) {
      ps.stockpile = addResources(ps.stockpile, delta);
    }
  }

// ---- City building construction & upgrades ----

export type BuildingKind = "housing" | "farmland" | "mine" | "arcane_spire";

export interface BuildBuildingResult {
  status:
    | "ok"
    | "not_found"
    | "unknown_kind"
    | "no_slots"
    | "insufficient_resources";
  message?: string;
  building?: any;
  resources?: Resources;
}

export interface UpgradeBuildingResult {
  status:
    | "ok"
    | "not_found"
    | "insufficient_resources";
  message?: string;
  building?: any;
  resources?: Resources;
}

const BUILDING_BASE_COST: Record<
  BuildingKind,
  { materials: number; wealth: number; mana?: number; niceName: string }
> = {
  housing: {
    materials: 60,
    wealth: 30,
    niceName: "Housing Block",
  },
  farmland: {
    materials: 50,
    wealth: 20,
    niceName: "Farmland Plot",
  },
  mine: {
    materials: 80,
    wealth: 40,
    niceName: "Mining Operation",
  },
  arcane_spire: {
    materials: 70,
    wealth: 50,
    mana: 30,
    niceName: "Arcane Spire",
  },
};

function canAffordBuilding(
  r: Resources,
  base: { materials: number; wealth: number; mana?: number },
  level: number
): { ok: boolean; cost: { materials: number; wealth: number; mana?: number } } {
  // simple scaling: each level costs +40%
  const scale = 1 + (level - 1) * 0.4;
  const materials = Math.round(base.materials * scale);
  const wealth = Math.round(base.wealth * scale);
  const mana = base.mana ? Math.round(base.mana * scale) : undefined;

  if (
    r.materials < materials ||
    r.wealth < wealth ||
    (mana != null && r.mana < mana)
  ) {
    return {
      ok: false,
      cost: { materials, wealth, mana },
    };
  }

  return {
    ok: true,
    cost: { materials, wealth, mana },
  };
}

export function buildBuildingForPlayer(
  playerId: string,
  kind: BuildingKind,
  now: Date
): BuildBuildingResult {
  const ps = getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  const base = BUILDING_BASE_COST[kind];
  if (!base) {
    return { status: "unknown_kind", message: "Unknown building kind" };
  }

  // advance sim
  tickPlayerState(ps, now);

  if (ps.city.buildings.length >= ps.city.maxBuildingSlots) {
    return {
      status: "no_slots",
      message: "No free building slots available.",
    };
  }

  const affordability = canAffordBuilding(ps.resources, base, 1);
  if (!affordability.ok) {
    const c = affordability.cost;
    return {
      status: "insufficient_resources",
      message: `Need ${c.materials} materials, ${c.wealth} wealth${
        c.mana ? ` and ${c.mana} mana` : ""
      } to construct this building.`,
    };
  }

  const cost = affordability.cost;
  ps.resources.materials -= cost.materials;
  ps.resources.wealth -= cost.wealth;
  if (cost.mana) {
    ps.resources.mana -= cost.mana;
  }

  const index = ps.city.buildings.length + 1;
  const name = `${base.niceName} ${index}`;

  const building = {
    id: `bld_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    kind,
    level: 1,
    name,
  };

  ps.city.buildings.push(building as any);

  pushEvent(ps, {
    kind: "building_constructed",
    message: `Constructed ${name}`,
  });

  return {
    status: "ok",
    building,
    resources: ps.resources,
  };
}

export function upgradeBuildingForPlayer(
  playerId: string,
  buildingId: string,
  now: Date
): UpgradeBuildingResult {
  const ps = getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  // advance sim
  tickPlayerState(ps, now);

  const building = ps.city.buildings.find((b: any) => b.id === buildingId) as
    | { id: string; name: string; kind: BuildingKind; level: number }
    | undefined;

  if (!building) {
    return { status: "not_found", message: "Building not found" };
  }

  const base = BUILDING_BASE_COST[building.kind];
  if (!base) {
    return {
      status: "unknown_kind",
      message: "Unknown building kind on existing building",
    } as any;
  }

  const nextLevel = building.level + 1;
  const affordability = canAffordBuilding(ps.resources, base, nextLevel);
  if (!affordability.ok) {
    const c = affordability.cost;
    return {
      status: "insufficient_resources",
      message: `Need ${c.materials} materials, ${c.wealth} wealth${
        c.mana ? ` and ${c.mana} mana` : ""
      } to upgrade this building.`,
    };
  }

  const cost = affordability.cost;
  ps.resources.materials -= cost.materials;
  ps.resources.wealth -= cost.wealth;
  if (cost.mana) {
    ps.resources.mana -= cost.mana;
  }

  building.level = nextLevel;

  pushEvent(ps, {
    kind: "building_upgraded",
    message: `Upgraded ${building.name} to level ${building.level}`,
  });

  return {
    status: "ok",
    building,
    resources: ps.resources,
  };
}

// ---- Research start API ----

export interface StartResearchResult {
  status:
    | "ok"
    | "not_found"
    | "unknown_tech"
    | "already_researched"
    | "already_researching";
  message?: string;
  research?: ActiveResearch;
}

export function startResearchForPlayer(
  playerId: string,
  techId: string,
  now: Date
): StartResearchResult {
  const ps = getPlayerState(playerId);
  if (!ps) {
    return { status: "not_found", message: "Player not found" };
  }

  const tech = getTechById(techId);
  if (!tech) {
    return { status: "unknown_tech", message: "Tech not found" };
  }

  if (ps.researchedTechIds.includes(techId)) {
    return {
      status: "already_researched",
      message: "Technology already researched",
    };
  }

  if (ps.activeResearch) {
    if (ps.activeResearch.techId === techId) {
      return {
        status: "already_researching",
        message: "Technology already being researched",
        research: ps.activeResearch,
      };
    }
    return {
      status: "already_researching",
      message: "Another research project is already in progress",
    };
  }

  const active: ActiveResearch = {
    techId: tech.id,
    progress: 0,
    startedAt: now.toISOString(),
  };
  ps.activeResearch = active;
  
  pushEvent(ps, {
    kind: "tech_start",
    message: `Research started: ${tech.name}`,
    techId: tech.id,
  });

  return { status: "ok", research: active };
}

// ----  War Effect/Impact To Region
function resolveMissionOutcome(
    ps: PlayerState,
    active: ActiveMission
  ): MissionOutcome {
    const mission = active.mission;
    const recommended = mission.recommendedPower || 0;
  
    // What force did we actually send?
    let forcePower = 0;
    if (mission.kind === "hero" && active.assignedHeroId) {
      const h = ps.heroes.find((x) => x.id === active.assignedHeroId);
      forcePower = h?.power ?? 0;
    } else if (mission.kind === "army" && active.assignedArmyId) {
      const a = ps.armies.find((x) => x.id === active.assignedArmyId);
      forcePower = a?.power ?? 0;
    }
  
    const safeRecommended = Math.max(10, recommended);
    const ratio = forcePower > 0 ? forcePower / safeRecommended : 0.5;
  
    // Base success chance: ~40% at parity, better if overpowered, worse if underpowered.
    let successChance = 0.4 + (ratio - 1) * 0.25;
    if (ratio >= 1.5) successChance += 0.15;
    if (ratio <= 0.5) successChance -= 0.15;
    successChance = Math.max(0.1, Math.min(0.95, successChance));
  
    const roll = Math.random();
  
    let kind: MissionOutcomeKind;
    if (roll < successChance * 0.7) {
      kind = "success";
    } else if (roll < successChance * 1.1) {
      kind = "partial";
    } else {
      kind = "failure";
    }
  
    let casualtyRate: number;
    switch (kind) {
      case "success":
        casualtyRate = 0.05 + Math.random() * 0.1; // 5–15%
        break;
      case "partial":
        casualtyRate = 0.15 + Math.random() * 0.2; // 15–35%
        break;
      case "failure":
        casualtyRate = 0.35 + Math.random() * 0.4; // 35–75%
        break;
    }
  
    let heroInjury: MissionOutcome["heroInjury"] = "none";
    if (mission.kind === "hero") {
      if (casualtyRate > 0.5) heroInjury = "severe";
      else if (casualtyRate > 0.25) heroInjury = "light";
      else heroInjury = "none";
    }
  
    return {
      kind,
      successChance,
      roll,
      casualtyRate,
      heroInjury,
    };
  }
  
  function applyMissionImpactToRegion(
    ps: PlayerState,
    mission: MissionOffer,
    outcome: MissionOutcome
  ): void {
    const region = ps.regionWar.find((rw) => rw.regionId === mission.regionId);
    if (!region) return;
  
    let controlDelta = 0;
    let threatDelta = 0;
  
    switch (outcome.kind) {
      case "success":
        controlDelta = +5;
        threatDelta = -5;
        break;
      case "partial":
        controlDelta = +2;
        threatDelta = -2;
        break;
      case "failure":
        controlDelta = -3;
        threatDelta = +4;
        break;
    }
  
    region.control = Math.max(0, Math.min(100, region.control + controlDelta));
    region.threat = Math.max(0, Math.min(100, region.threat + threatDelta));
  }

// Expose tick config so API can tell client tickMs
export { tickConfig };
