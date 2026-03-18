//web-backend/gameState.ts

import { generateMissionOffers } from "./domain/missions";
import { addResources } from "./domain/resources";
import {
  tickConfig,
} from "./config";
import {
  type ResourceTierState,
  applyResourceTiersToProduction as applyResourceTiersToProductionHelper,
  applySpecializationToProduction as applySpecializationToProductionHelper,
  getOrInitResourceTier as getOrInitResourceTierHelper,
} from "./gameState/gameStateProduction";
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
import { tickPlayerState as tickPlayerStateHelper } from "./gameState/gameStateEconomy";
import {
  type CityMorphResult as CityMorphResultType,
  type TierUpResult as TierUpResultType,
  tierUpCityForPlayer as tierUpCityForPlayerHelper,
  morphCityForPlayer as morphCityForPlayerHelper,
} from "./gameState/gameStateCityProgression";
import {
  createInitialGameState,
  getOrCreatePlayerState as getOrCreatePlayerStateHelper,
  pushEvent as pushEventHelper,
} from "./gameState/gameStateCore";

import type { World, RegionId } from "./domain/world";
import type { City, BuildingProduction } from "./domain/city";
import type { Hero, HeroRole } from "./domain/heroes";
import type { Army, ArmyType } from "./domain/armies";
import type {
  MissionOffer,
  MissionDifficulty,
  RewardBundle,
} from "./domain/missions";
import type { TechAge, TechEpoch, TechCategory } from "./domain/tech";
import type { ResourceKey, ResourceVector } from "./domain/resources";
import type { PublicInfrastructureState } from "./domain/publicInfrastructure";

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

  publicInfrastructure: PublicInfrastructureState;
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

export type { CityMorphResult, TierUpResult } from "./gameState/gameStateCityProgression";

const cityProgressionDeps = {
  getPlayerState,
  tickPlayerState,
  clampStat,
};

export function tierUpCityForPlayer(
  playerId: string,
  now: Date
 ): TierUpResultType {
  return tierUpCityForPlayerHelper(cityProgressionDeps, playerId, now);
}

export function morphCityForPlayer(
  playerId: string,
  morphId: string,
  now: Date
 ): CityMorphResultType {
  return morphCityForPlayerHelper(cityProgressionDeps, playerId, morphId, now);
}

export type { ResourceTierState } from "./gameState/gameStateProduction";

export function getOrInitResourceTier(
  ps: PlayerState,
  key: ResourceKey
): ResourceTierState {
  return getOrInitResourceTierHelper(ps, key);
}

function applySpecializationToProduction(
  city: City,
  base: BuildingProduction
): BuildingProduction {
  return applySpecializationToProductionHelper(city, base);
}

function applyResourceTiersToProduction(
  ps: PlayerState,
  base: BuildingProduction
): BuildingProduction {
  return applyResourceTiersToProductionHelper(ps, base);
}

// ---- Game state singleton ----

const gameState: GameState = createInitialGameState(DEMO_PLAYER_ID, defaultPolicies);

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

export function getOrCreatePlayerState(playerId: string): PlayerState {
  return getOrCreatePlayerStateHelper(gameState, playerId, defaultPolicies);
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
  pushEventHelper(ps, input);
}

// City Stress

export function tickPlayerState(ps: PlayerState, now: Date): void {
  tickPlayerStateHelper(
    {
      tickMs: TICK_MS,
      maxTicksPerRequest: MAX_TICKS_PER_REQUEST,
      getWorld: () => gameState.world,
      clampStat,
      pushEvent,
      applySpecializationToProduction,
      applyResourceTiersToProduction,
    },
    ps,
    now
  );
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
  now: Date,
  preferredHeroId?: string,
  preferredArmyId?: string
): ActiveMission | null {
  return startMissionForPlayerImpl(
    playerId,
    missionId,
    now,
    preferredHeroId,
    preferredArmyId
  );
}

function startMissionForPlayerImpl(
  playerId: string,
  missionId: string,
  now: Date,
  preferredHeroId?: string,
  preferredArmyId?: string
): ActiveMission | null {
  return startMissionForPlayerHelper(
    missionStateDeps,
    playerId,
    missionId,
    now,
    preferredHeroId,
    preferredArmyId
  );
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
