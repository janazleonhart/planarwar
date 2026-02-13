// worldcore/test/contract_townBaselinePlanner_innAnchor.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { planTownBaselines } from "../sim/TownBaselinePlanner";

test("[contract] TownBaselinePlanner: seedInns places town_innkeeper NPC spawn when enabled", () => {
  const towns = [
    {
      shardId: "prime_shard",
      spawnId: "town_test_1",
      type: "town",
      x: 100,
      y: 0,
      z: 100,
      regionId: null,
      townTier: 1,
    },
  ];

  const plan = planTownBaselines(towns, {
    bounds: { minCx: -1000, maxCx: 1000, minCz: -1000, maxCz: 1000 },
    cellSize: 16,
    townTypes: ["town"],

    seedMailbox: false,
    seedRest: false,
    seedStations: false,
    stationProtoIds: [],

    seedVendors: false,
    vendorCount: 0,
    vendorProtoId: "starter_alchemist",

    seedTrainers: false,
    trainerCount: 0,
    trainerProtoId: "town_trainer",

    seedBanks: false,
    seedGuildbanks: false,
    seedMailServices: false,
    seedAuctions: false,

    // The thing we're testing
    seedInns: true,
    innCount: 1,
    innProtoId: "town_innkeeper",

    guardCount: 0,
    dummyCount: 0,

    spawnIdMode: "legacy",
    seedBase: "seed:town_baseline",
  });

  const innSpawns = plan.actions
    .filter((a) => a.kind === "place_spawn")
    .map((a) => a.spawn)
    .filter((s) => s.type === "npc" && s.protoId === "town_innkeeper");

  assert.equal(innSpawns.length, 1, "Expected exactly one innkeeper NPC spawn");
});
