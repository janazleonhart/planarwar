//web-backend/gameState/gameStateCore.ts

import { seedWorld } from "../domain/world";
import { seedStarterCity } from "../domain/city";
import { seedStarterHeroes } from "../domain/heroes";
import { seedStarterArmies } from "../domain/armies";
import { startingResourcesConfig } from "../config";
import { createInitialPublicInfrastructureState } from "../domain/publicInfrastructure";

import type { City } from "../domain/city";
import type { ResourceVector } from "../domain/resources";
import type { World } from "../domain/world";
import type {
  CityStorage,
  GameEvent,
  GameEventInput,
  GameState,
  PlayerState,
  PoliciesState,
  RegionWarState,
  Resources,
} from "../gameState";

const MAX_EVENT_LOG = 100;

export function seedRegionWar(world: World, city: City): RegionWarState[] {
  const shard = world.shards[0];
  return shard.regions.map((region) => ({
    regionId: region.id,
    control: region.id === city.regionId ? 70 : 40,
    threat: region.dangerLevel * 5,
  }));
}

function createBaseResources(): Resources {
  return {
    food: startingResourcesConfig.food,
    materials: startingResourcesConfig.materials,
    wealth: startingResourcesConfig.wealth,
    mana: startingResourcesConfig.mana,
    knowledge: startingResourcesConfig.knowledge,
    unity: startingResourcesConfig.unity,
  };
}

function createBaseStockpile(): ResourceVector {
  return {
    food: startingResourcesConfig.food,
    materials_generic: startingResourcesConfig.materials,
    wealth: startingResourcesConfig.wealth,
    mana_arcane: startingResourcesConfig.mana,
    knowledge: startingResourcesConfig.knowledge,
    unity: startingResourcesConfig.unity,
  };
}

function createInitialStorage(stockpile: ResourceVector): CityStorage {
  return {
    protectedCapacity: { ...stockpile },
    protectedStock: { ...stockpile },
    vulnerableStock: {},
  };
}

export function createInitialPlayerState(
  playerId: string,
  world: World,
  defaultPolicies: PoliciesState,
  nowIso = new Date().toISOString()
): PlayerState {
  const city = seedStarterCity(playerId);
  const heroes = seedStarterHeroes(playerId);
  const armies = seedStarterArmies(city.id);
  const resources = createBaseResources();
  const stockpile = createBaseStockpile();
  const storage = createInitialStorage(stockpile);
  const regionWar = seedRegionWar(world, city);

  return {
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
    threatWarnings: [],
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
    publicInfrastructure: createInitialPublicInfrastructureState(nowIso),
  };
}

export function createInitialGameState(
  demoPlayerId: string,
  defaultPolicies: PoliciesState
): GameState {
  const world = seedWorld();
  const playerState = createInitialPlayerState(demoPlayerId, world, defaultPolicies);
  const players = new Map<string, PlayerState>();
  players.set(demoPlayerId, playerState);
  return { world, players };
}

export function getOrCreatePlayerState(
  gameState: GameState,
  playerId: string,
  defaultPolicies: PoliciesState
): PlayerState {
  const existing = gameState.players.get(playerId);
  if (existing) return existing;

  const ps = createInitialPlayerState(playerId, gameState.world, defaultPolicies);
  gameState.players.set(playerId, ps);
  return ps;
}

export function pushEvent(ps: PlayerState, input: GameEventInput): void {
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
