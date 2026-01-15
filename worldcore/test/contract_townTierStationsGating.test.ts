// worldcore/test/contract_townTierStationsGating.test.ts
//
// Contract: town-baseline station seeding must respect TownTierRules when
// respectTownTierStations=true.
//
// Expectations (per TownTierRules.ts):
// - Tier 1: no stations
// - Tier 2: oven + mill
// - Tier 3: oven + mill + forge
// - Tier 4: oven + mill + forge + alchemy
// - Tier 5: same as 4 for now
//
// Also:
// - If tier is unknown and gating is on, planner defaults to tier 1 => no stations.

import test from "node:test";
import assert from "node:assert/strict";

import { planTownBaselines } from "../sim/TownBaselinePlanner";

type Bounds = { minCx: number; maxCx: number; minCz: number; maxCz: number };

function baseOpts(overrides: Partial<Parameters<typeof planTownBaselines>[1]> = {}) {
  const bounds: Bounds = { minCx: -100, maxCx: 100, minCz: -100, maxCz: 100 };

  return {
    bounds,
    cellSize: 64,
    townTypes: ["town"],

    seedMailbox: false,
    mailboxType: "mailbox",
    mailboxProtoId: "mailbox_basic",
    mailboxRadius: 8,

    seedRest: false,
    restType: "rest",
    restProtoId: "rest_spot_basic",
    restRadius: 10,

    seedStations: true,
    stationType: "station",
    stationProtoIds: ["station_forge", "station_alchemy", "station_oven", "station_mill"],
    stationRadius: 0, // keep spawned coords exactly at town center for deterministic tests

    guardCount: 0,
    guardProtoId: "town_guard",
    guardRadius: 12,

    dummyCount: 0,
    dummyProtoId: "training_dummy_big",
    dummyRadius: 10,

    ...overrides,
  };
}

function townRow(overrides: Partial<any> = {}) {
  return {
    shardId: "prime_shard",
    spawnId: "town_test_1",
    type: "town",
    archetype: "town", // ensure string, never undefined
    protoId: "town",
    variantId: null,
    x: 0,
    y: 0,
    z: 0,
    regionId: "prime_shard:0,0",
    townTier: null,
    ...overrides,
  };
}

function stationProtoIdsFrom(result: any): string[] {
  return (result.actions ?? [])
    .filter((a: any) => a?.kind === "place_spawn" && a?.spawn?.type === "station")
    .map((a: any) => String(a.spawn.protoId));
}

test("[contract] tier 1 towns seed NO stations when gating is enabled", () => {
  const town = townRow({ townTier: 1 });
  const res = planTownBaselines([town], baseOpts({ respectTownTierStations: true }));
  const stations = stationProtoIdsFrom(res);
  assert.deepEqual(stations, []);
});

test("[contract] unknown tier defaults to tier 1 => seeds NO stations when gating is enabled", () => {
  const town = townRow({ townTier: null, variantId: null, spawnId: "town_no_tier_token" });
  const res = planTownBaselines([town], baseOpts({ respectTownTierStations: true }));
  const stations = stationProtoIdsFrom(res);
  assert.deepEqual(stations, []);
});

test("[contract] tier 3 towns seed forge+oven+mill (but NOT alchemy) when gating is enabled", () => {
  const town = townRow({ townTier: 3 });
  const res = planTownBaselines([town], baseOpts({ respectTownTierStations: true }));
  const stations = stationProtoIdsFrom(res);

  // Planner intersects in the caller-provided order:
  // ["forge","alchemy","oven","mill"] ∩ tier3["oven","mill","forge"] => ["forge","oven","mill"]
  assert.deepEqual(stations, ["station_forge", "station_oven", "station_mill"]);
});

test("[contract] gating OFF seeds all configured stations regardless of tier", () => {
  const town = townRow({ townTier: 1 });
  const res = planTownBaselines([town], baseOpts({ respectTownTierStations: false }));
  const stations = stationProtoIdsFrom(res);

  assert.deepEqual(stations, ["station_forge", "station_alchemy", "station_oven", "station_mill"]);
});
