//web-backend/test/cityRuntimeSnapshot.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type {
  PlayerState,
  PoliciesState,
  Resources,
  ActiveMission,
  ActiveResearch,
  RegionWarState,
  GameEvent,
  CityStressState,
  CityStorage,
} from "../gameState";
import type { WorldConsequenceState } from "../domain/worldConsequences";
import type { ThreatWarning } from "../domain/missions";
import type { MotherBrainPressureWindow } from "../domain/missions";
import type { MissionDefenseReceipt } from "../domain/missions";
import type { City } from "../domain/city";
import type { Hero } from "../domain/heroes";
import type { Army } from "../domain/armies";
import type { MissionOffer } from "../domain/missions";
import type { WorkshopJob } from "../gameState/gameStateHeroes";
import type { ResourceVector } from "../domain/resources";
import type { ResourceTierState } from "../gameState/gameStateProduction";
import type { TechAge, TechEpoch, TechCategory } from "../domain/tech";
import { createInitialPublicInfrastructureState } from "../domain/publicInfrastructure";
import {
  buildBuildingForPlayer,
  getOrCreatePlayerState,
  raiseArmyForPlayer,
  recruitHeroForPlayer,
} from "../gameState";
import {
  buildCityRuntimeEnvelope,
  hydratePlayerStateFromCityRow,
  readCityRuntimeSnapshot,
} from "../gameState/cityRuntimeSnapshot";

function makePlayerState(overrides: Partial<PlayerState> = {}): PlayerState {
  const city: City = {
    id: "city_default",
    ownerId: "owner_default",
    name: "Default Hold",
    shardId: "prime_shard",
    regionId: "default_region" as any,
    tier: 1,
    maxBuildingSlots: 6,
    stats: {
      population: 10,
      stability: 60,
      prosperity: 50,
      security: 45,
      infrastructure: 35,
      arcaneSaturation: 15,
      influence: 25,
      unity: 55,
    },
    buildings: [
      { id: "b1", kind: "housing", level: 1, name: "Residential Block 1" },
    ],
    specializationId: null as any,
    specializationStars: 0,
    specializationStarsHistory: {},
  };

  const policies: PoliciesState = {
    highTaxes: false,
    openTrade: true,
    conscription: false,
    arcaneFreedom: true,
  };

  const resources: Resources = {
    food: 100,
    materials: 75,
    wealth: 50,
    mana: 20,
    knowledge: 15,
    unity: 30,
  };

  const stockpile: ResourceVector = {
    food: 100,
    wood: 10,
    stone: 20,
    ore: 5,
    herbs: 3,
    fish: 8,
    luxury: 1,
    mana: 20,
  } as ResourceVector;

  const resourceTiers: Partial<Record<any, ResourceTierState>> = {
    fish_common: { resourceKey: "fish_common", tier: 2, stars: 1, totalInvested: 10 },
  };

  const currentOffers: MissionOffer[] = [];
  const activeMissions: ActiveMission[] = [];
  const activeResearch: ActiveResearch = {
    techId: "tech_alpha",
    progress: 12,
    startedAt: "2026-03-12T00:00:00.000Z",
  };
  const regionWar: RegionWarState[] = [{ regionId: "war_region" as any, control: 55, threat: 22 }];
  const eventLog: GameEvent[] = [{
    id: "evt1",
    timestamp: "2026-03-12T00:00:00.000Z",
    kind: "city_tier_up",
    message: "Tier rose",
  }];
  const workshopJobs: WorkshopJob[] = [];
  const cityStress: CityStressState = {
    stage: "stable",
    total: 10,
    foodPressure: 5,
    threatPressure: 2,
    unityPressure: 3,
    recoveryBurden: 0,
    lastUpdatedAt: "2026-03-12T00:00:00.000Z",
  };

  const threatWarnings: ThreatWarning[] = [];
  const motherBrainPressureMap: MotherBrainPressureWindow[] = [];
  const missionReceipts: MissionDefenseReceipt[] = [];
  const worldConsequences = [];
  const worldConsequenceState: WorldConsequenceState = {
    regions: [],
    worldEconomy: {
      tradePressure: 0,
      supplyFriction: 0,
      cartelAttention: 0,
      destabilization: 0,
      outlook: "stable",
    },
    blackMarket: {
      opportunityScore: 0,
      heat: 0,
      outlook: "quiet",
    },
    factionPressure: {
      driftScore: 0,
      instability: 0,
      dominantStance: "stable",
    },
    summary: {
      affectedRegionIds: [],
      totalLedgerEntries: 0,
      severeCount: 0,
      destabilizationScore: 0,
      note: "No exported city consequences yet.",
    },
    lastUpdatedAt: "2026-03-12T00:00:00.000Z",
  };

  const base: PlayerState = {
    playerId: "player_default",
    city,
    heroes: [] as Hero[],
    armies: [] as Army[],
    resources,
    stockpile,
    resourceTiers,
    currentOffers,
    activeMissions,
    threatWarnings,
    motherBrainPressureMap,
    missionReceipts,
    policies,
    lastTickAt: "2026-03-12T00:00:00.000Z",
    researchedTechIds: ["tech_alpha"],
    activeResearch,
    regionWar,
    eventLog,
    workshopJobs,
    cityStress,
    storage: {
      protectedCapacity: { food: 100, materials_generic: 100, wealth: 100, knowledge: 100, unity: 100 },
      protectedStock: { food: 60, materials_generic: 40, wealth: 10, knowledge: 5, unity: 5 },
      vulnerableStock: { food: 40, materials_generic: 35, wealth: 40, knowledge: 10, unity: 25 },
    } as CityStorage,
    techAge: "bronze" as TechAge,
    techEpoch: "dawn" as TechEpoch,
    techCategoryAges: { civics: "bronze" as TechAge } as Partial<Record<TechCategory, TechAge>>,
    techFlags: ["CITY_ENABLED"],
    publicInfrastructure: createInitialPublicInfrastructureState("2026-03-16T00:00:00.000Z"),
    worldConsequences,
    worldConsequenceState,
  };

  return {
    ...base,
    ...overrides,
    city: { ...base.city, ...(overrides.city ?? {}) },
  };
}

function makeViewerAuthority(ownerId = "owner_row") {
  return { userId: ownerId, playerId: ownerId };
}

function makeCityRowFromPlayerState(
  ps: PlayerState,
  overrides: Partial<{ id: string; account_id: string; shard_id: string; name: string; meta: Record<string, any> }> = {},
) {
  return {
    id: overrides.id ?? ps.city.id,
    account_id: overrides.account_id ?? ps.city.ownerId,
    shard_id: overrides.shard_id ?? ps.city.shardId,
    name: overrides.name ?? ps.city.name,
    meta: overrides.meta ?? buildCityRuntimeEnvelope(ps),
  };
}

function hydrateRoundTrip(
  ps: PlayerState,
  overrides: Partial<{ id: string; account_id: string; shard_id: string; name: string; meta: Record<string, any> }> = {},
) {
  const row = makeCityRowFromPlayerState(ps, overrides);
  const target = makePlayerState({
    playerId: `${ps.playerId}_target`,
    city: {
      id: `${ps.city.id}_old`,
      ownerId: `${ps.city.ownerId}_old`,
      name: "Old Name",
      shardId: "old_shard",
      regionId: "old_region" as any,
    } as any,
  });
  return hydratePlayerStateFromCityRow(target, row, makeViewerAuthority(row.account_id));
}

test("readCityRuntimeSnapshot accepts legacy unversioned runtimeState payloads", () => {
  const ps = makePlayerState();
  const envelope = buildCityRuntimeEnvelope(ps);
  const legacyMeta = {
    runtimeState: envelope.runtimeState,
  };

  const snapshot = readCityRuntimeSnapshot(legacyMeta);

  assert.ok(snapshot);
  assert.equal(snapshot?.version, 1);
  assert.equal(snapshot?.city.regionId, ps.city.regionId);
});

test("hydratePlayerStateFromCityRow prefers DB row authority for id owner name and shard", () => {
  const source = makePlayerState({
    playerId: "player_snapshot",
    city: {
      id: "city_snapshot",
      ownerId: "owner_snapshot",
      name: "Snapshot Name",
      shardId: "snapshot_shard",
      regionId: "runtime_region" as any,
      tier: 3,
      maxBuildingSlots: 12,
      stats: {
        population: 200,
        stability: 90,
        prosperity: 88,
        security: 77,
        infrastructure: 66,
        arcaneSaturation: 55,
        influence: 44,
        unity: 99,
      },
      buildings: [
        { id: "b_runtime", kind: "mine", level: 4, name: "Deep Mine" },
      ],
      specializationId: "materials_star",
      specializationStars: 2,
      specializationStarsHistory: { materials_star: 2 },
    } as any,
  });

  const row = {
    id: "city_row",
    account_id: "owner_row",
    shard_id: "prime_shard",
    name: "Row Name",
    meta: buildCityRuntimeEnvelope(source, { regionId: "legacy_row_region" }),
  };

  const target = makePlayerState({
    playerId: "player_old",
    city: {
      id: "city_old",
      ownerId: "owner_old",
      name: "Old Name",
      shardId: "old_shard",
      regionId: "old_region" as any,
    } as any,
  });

  const hydrated = hydratePlayerStateFromCityRow(target, row, { userId: "owner_row", playerId: "player_row" });

  assert.equal(hydrated.playerId, "player_row");
  assert.equal(hydrated.city.id, "city_row");
  assert.equal(hydrated.city.ownerId, "owner_row");
  assert.equal(hydrated.city.name, "Row Name");
  assert.equal(hydrated.city.shardId, "prime_shard");
  assert.equal(hydrated.city.regionId, "runtime_region");
  assert.equal(hydrated.city.tier, 3);
  assert.equal(hydrated.city.buildings[0]?.id, "b_runtime");
});

test("hydratePlayerStateFromCityRow falls back to row meta region when no usable snapshot exists", () => {
  const target = makePlayerState({
    city: {
      regionId: "old_region" as any,
      name: "Old Name",
    } as any,
  });

  const row = {
    id: "city_row",
    account_id: "owner_row",
    shard_id: "prime_shard",
    name: "Row Name",
    meta: {
      regionId: "legacy_row_region",
      runtimeStateVersion: 99,
      runtimeState: { version: 99 },
    },
  };

  const hydrated = hydratePlayerStateFromCityRow(target, row, { userId: "owner_row", playerId: "player_row" });

  assert.equal(hydrated.city.regionId, "legacy_row_region");
  assert.equal(hydrated.city.name, "Row Name");
});

test("building mutation persists through snapshot save and reload", () => {
  const playerId = `test_building_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const ps = getOrCreatePlayerState(playerId);
  ps.city.id = `city_${playerId}`;
  ps.city.ownerId = `owner_${playerId}`;
  ps.city.name = "Builder Hold";
  ps.city.shardId = "prime_shard";
  ps.city.regionId = "builder_region" as any;
  ps.resources.materials = 500;
  ps.resources.wealth = 500;
  ps.resources.mana = 200;

  const startingCount = ps.city.buildings.length;
  const result = buildBuildingForPlayer(playerId, "farmland", new Date("2026-03-16T12:00:00.000Z"));

  assert.equal(result.status, "ok");
  assert.ok(result.building);
  assert.equal(ps.city.buildings.length, startingCount + 1);

  const hydrated = hydrateRoundTrip(ps);

  assert.equal(hydrated.city.buildings.length, ps.city.buildings.length);
  assert.equal(hydrated.city.buildings.at(-1)?.id, result.building?.id);
  assert.equal(hydrated.city.buildings.at(-1)?.kind, "farmland");
  assert.equal(hydrated.resources.materials, ps.resources.materials);
  assert.equal(hydrated.resources.wealth, ps.resources.wealth);
});

test("hero mutation persists through snapshot save and reload", () => {
  const playerId = `test_hero_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const ps = getOrCreatePlayerState(playerId);
  ps.city.id = `city_${playerId}`;
  ps.city.ownerId = `owner_${playerId}`;
  ps.city.name = "Hero Hold";
  ps.city.shardId = "prime_shard";
  ps.resources.wealth = 500;
  ps.resources.unity = 100;

  const startingHeroCount = ps.heroes.length;
  const startingEventCount = ps.eventLog.length;

  const result = recruitHeroForPlayer(playerId, "champion", new Date("2026-03-16T12:05:00.000Z"));

  assert.equal(result.status, "ok");
  assert.ok(result.hero);
  assert.equal(ps.heroes.length, startingHeroCount + 1);

  const hydrated = hydrateRoundTrip(ps);

  assert.equal(hydrated.heroes.length, startingHeroCount + 1);
  assert.ok(hydrated.heroes.some((hero) => hero.id === result.hero?.id));
  assert.equal(
    hydrated.heroes.find((hero) => hero.id === result.hero?.id)?.role,
    "champion",
  );
  assert.equal(hydrated.resources.wealth, ps.resources.wealth);
  assert.equal(hydrated.resources.unity, ps.resources.unity);
  assert.ok(hydrated.eventLog.length >= startingEventCount + 1);
  assert.ok(hydrated.eventLog.some((event) => event.kind === "hero_recruited"));
});

test("army mutation persists through snapshot save and reload", () => {
  const playerId = `test_army_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const ps = getOrCreatePlayerState(playerId);
  ps.city.id = `city_${playerId}`;
  ps.city.ownerId = `owner_${playerId}`;
  ps.city.name = "Army Hold";
  ps.city.shardId = "prime_shard";
  ps.resources.materials = 800;
  ps.resources.wealth = 800;

  const startingArmyCount = ps.armies.length;
  const startingEventCount = ps.eventLog.length;

  const raised = raiseArmyForPlayer(playerId, "militia", new Date("2026-03-16T12:10:00.000Z"));
  assert.equal(raised.status, "ok");
  assert.ok(raised.army);
  assert.equal(ps.armies.length, startingArmyCount + 1);

  const hydrated = hydrateRoundTrip(ps);

  assert.equal(hydrated.armies.length, startingArmyCount + 1);
  assert.ok(hydrated.armies.some((army) => army.id === raised.army?.id));
  assert.equal(
    hydrated.armies.find((army) => army.id === raised.army?.id)?.type,
    "militia",
  );
  assert.equal(
    hydrated.armies.find((army) => army.id === raised.army?.id)?.status,
    "idle",
  );
  assert.equal(hydrated.resources.materials, ps.resources.materials);
  assert.equal(hydrated.resources.wealth, ps.resources.wealth);
  assert.ok(hydrated.eventLog.length >= startingEventCount + 1);
  assert.ok(hydrated.eventLog.some((event) => event.kind === "army_raised"));
});