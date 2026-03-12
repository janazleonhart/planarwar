//web-backend/gameState.ts

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
} from "./config";
import { getTierConfig, getMorphConfig } from "./config/cityTierConfig";
import {
  type CompleteMissionResult,
  type GarrisonStrikeResult,
  type MissionOutcome,
  type MissionOutcomeKind,
  type WarfrontAssaultResult,
  completeMissionForPlayer as completeMissionForPlayerHelper,
  regenerateRegionMissionsForPlayer as regenerateRegionMissionsForPlayerHelper,
  startGarrisonStrikeForPlayer as startGarrisonStrikeForPlayerHelper,
  startMissionForPlayer as startMissionForPlayerHelper,
  startWarfrontAssaultForPlayer as startWarfrontAssaultForPlayerHelper,
} from "./gameState/gameStateMissions";
import {
  type BuildBuildingResult,
  type BuildingKind,
  type StartResearchResult,
  type UpgradeBuildingResult,
  buildBuildingForPlayer as buildBuildingForPlayerHelper,
  startResearchForPlayer as startResearchForPlayerHelper,
  upgradeBuildingForPlayer as upgradeBuildingForPlayerHelper,
} from "./gameState/gameStateCityDevelopment";
import {
  type RaiseArmyResult,
  type ReinforceArmyResult,
  raiseArmyForPlayer as raiseArmyForPlayerHelper,
  reinforceArmyForPlayer as reinforceArmyForPlayerHelper,
} from "./gameState/gameStateArmies";
import {
  type CompleteWorkshopJobResult,
  type EquipHeroAttachmentResult,
  type HeroAttachmentKind,
  type RecruitHeroResult,
  type StartWorkshopJobResult,
  type WorkshopJob,
  completeWorkshopJobForPlayer as completeWorkshopJobForPlayerHelper,
  equipHeroAttachmentForPlayer as equipHeroAttachmentForPlayerHelper,
  recruitHeroForPlayer as recruitHeroForPlayerHelper,
  startWorkshopJobForPlayer as startWorkshopJobForPlayerHelper,
} from "./gameState/gameStateHeroes";

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

export function getOrCreatePlayerState(playerId: string): PlayerState {
  const existing = gameState.players.get(playerId);
  if (existing) return existing;

  const nowIso = new Date().toISOString();
  const world = gameState.world;

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

  // Internal multi-resource breakdown – mirror the basics for now.
  const stockpile: ResourceVector = {
    food: startingResourcesConfig.food,
    materials_generic: startingResourcesConfig.materials,
    wealth: startingResourcesConfig.wealth,
    mana_arcane: startingResourcesConfig.mana,
    knowledge: startingResourcesConfig.knowledge,
    unity: startingResourcesConfig.unity,
  };

  // City storage starts with everything protected.
  const storage: CityStorage = {
    protectedCapacity: { ...stockpile },
    protectedStock: { ...stockpile },
    vulnerableStock: {},
  };

  const regionWar = seedRegionWar(world, city);

  const ps: PlayerState = {
    playerId,
    city,
    heroes,
    armies,
    resources,
    stockpile,
    storage,
    resourceTiers: {},
    currentOffers: [],
    activeMissions: [],
    policies: { ...defaultPolicies },
    lastTickAt: nowIso,

    researchedTechIds: [],
    techAge: "wood",
    techEpoch: "genesis",
    techCategoryAges: {},
    techFlags: [],
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

  gameState.players.set(playerId, ps);
  return ps;
}


export interface GameEventInput {
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

const missionStateDeps = {
  gameState,
  getPlayerState,
  tickPlayerState,
  pushEvent,
  applyRewards,
};

export function startMissionForPlayer(
  playerId: string,
  missionId: string,
  now: Date
): ActiveMission | null {
  return startMissionForPlayerImpl(playerId, missionId, now);
}

function startMissionForPlayerImpl(
  playerId: string,
  missionId: string,
  now: Date
): ActiveMission | null {
  return startMissionForPlayerHelper(missionStateDeps, playerId, missionId, now);
}

export function regenerateRegionMissionsForPlayer(
  playerId: string,
  targetRegionId: RegionId,
  now: Date
): MissionOffer[] | null {
  return regenerateRegionMissionsForPlayerImpl(playerId, targetRegionId, now);
}

function regenerateRegionMissionsForPlayerImpl(
  playerId: string,
  targetRegionId: RegionId,
  now: Date
): MissionOffer[] | null {
  return regenerateRegionMissionsForPlayerHelper(missionStateDeps, playerId, targetRegionId, now);
}

export function startWarfrontAssaultForPlayer(
  playerId: string,
  regionId: RegionId,
  now: Date
): WarfrontAssaultResult {
  return startWarfrontAssaultForPlayerImpl(playerId, regionId, now);
}

function startWarfrontAssaultForPlayerImpl(
  playerId: string,
  regionId: RegionId,
  now: Date
): WarfrontAssaultResult {
  return startWarfrontAssaultForPlayerHelper(missionStateDeps, playerId, regionId, now);
}

export function startGarrisonStrikeForPlayer(
  playerId: string,
  regionId: RegionId,
  now: Date
): GarrisonStrikeResult {
  return startGarrisonStrikeForPlayerImpl(playerId, regionId, now);
}

function startGarrisonStrikeForPlayerImpl(
  playerId: string,
  regionId: RegionId,
  now: Date
): GarrisonStrikeResult {
  return startGarrisonStrikeForPlayerHelper(missionStateDeps, playerId, regionId, now);
}

export function completeMissionForPlayer(
  playerId: string,
  instanceId: string,
  now: Date
): CompleteMissionResult {
  return completeMissionForPlayerImpl(playerId, instanceId, now);
}

function completeMissionForPlayerImpl(
  playerId: string,
  instanceId: string,
  now: Date
): CompleteMissionResult {
  return completeMissionForPlayerHelper(missionStateDeps, playerId, instanceId, now);
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

  // ---- Hero gear / workshop / recruitment ----

export type {
  CompleteWorkshopJobResult,
  EquipHeroAttachmentResult,
  HeroAttachment,
  HeroAttachmentKind,
  RecruitHeroResult,
  StartWorkshopJobResult,
  WorkshopJob,
} from "./gameState/gameStateHeroes";

const heroStateDeps = {
  getPlayerState,
  tickPlayerState,
  pushEvent,
};

export function equipHeroAttachmentForPlayer(
  playerId: string,
  heroId: string,
  kind: HeroAttachmentKind,
  now: Date
): EquipHeroAttachmentResult {
  return equipHeroAttachmentForPlayerHelper(heroStateDeps, playerId, heroId, kind, now);
}

export function startWorkshopJobForPlayer(
  playerId: string,
  kind: HeroAttachmentKind,
  now: Date
): StartWorkshopJobResult {
  return startWorkshopJobForPlayerHelper(heroStateDeps, playerId, kind, now);
}

export function completeWorkshopJobForPlayer(
  playerId: string,
  jobId: string,
  now: Date
): CompleteWorkshopJobResult {
  return completeWorkshopJobForPlayerHelper(heroStateDeps, playerId, jobId, now);
}

export function recruitHeroForPlayer(
  playerId: string,
  role: HeroRole,
  now: Date
): RecruitHeroResult {
  return recruitHeroForPlayerHelper(heroStateDeps, playerId, role, now);
}

// ---- Army recruitment & reinforcement ----

export type { RaiseArmyResult, ReinforceArmyResult } from "./gameState/gameStateArmies";

const armyStateDeps = {
  getPlayerState,
  tickPlayerState,
  pushEvent,
};

export function raiseArmyForPlayer(
  playerId: string,
  type: ArmyType,
  now: Date
): RaiseArmyResult {
  return raiseArmyForPlayerHelper(armyStateDeps, playerId, type, now);
}

export function reinforceArmyForPlayer(
  playerId: string,
  armyId: string,
  now: Date
): ReinforceArmyResult {
  return reinforceArmyForPlayerHelper(armyStateDeps, playerId, armyId, now);
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

export type { BuildingKind, BuildBuildingResult, UpgradeBuildingResult } from "./gameState/gameStateCityDevelopment";

export function buildBuildingForPlayer(
  playerId: string,
  kind: BuildingKind,
  now: Date
): BuildBuildingResult {
  return buildBuildingForPlayerHelper(
    { getPlayerState, tickPlayerState, pushEvent },
    playerId,
    kind,
    now
  );
}

export function upgradeBuildingForPlayer(
  playerId: string,
  buildingId: string,
  now: Date
): UpgradeBuildingResult {
  return upgradeBuildingForPlayerHelper(
    { getPlayerState, tickPlayerState, pushEvent },
    playerId,
    buildingId,
    now
  );
}

// ---- Research start API ----

export type { StartResearchResult } from "./gameState/gameStateCityDevelopment";

export function startResearchForPlayer(
  playerId: string,
  techId: string,
  now: Date
): StartResearchResult {
  return startResearchForPlayerHelper(
    { getPlayerState, pushEvent },
    playerId,
    techId,
    now
  );
}

// Expose tick config so API can tell client tickMs
export { tickConfig };
