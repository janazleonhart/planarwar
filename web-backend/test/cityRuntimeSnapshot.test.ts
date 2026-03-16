//web-backend/test/cityRuntimeSnapshot.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { PlayerState, PoliciesState, Resources, ActiveMission, ActiveResearch, RegionWarState, GameEvent, CityStressState, CityStorage } from "../gameState";
import type { City } from "../domain/city";
import type { Hero } from "../domain/heroes";
import type { Army } from "../domain/armies";
import type { MissionOffer } from "../domain/missions";
import type { WorkshopJob } from "../gameState/gameStateHeroes";
import type { ResourceVector } from "../domain/resources";
import type { ResourceTierState } from "../gameState/gameStateProduction";
import type { TechAge, TechEpoch, TechCategory } from "../domain/tech";
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
  };

  return {
    ...base,
    ...overrides,
    city: { ...base.city, ...(overrides.city ?? {}) },
  };
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
