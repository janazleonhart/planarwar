// worldcore/test/contract_townBaselinePlanner_seedTownServices.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { planTownBaselines } from "../sim/TownBaselinePlanner";

function countNpc(plan: ReturnType<typeof planTownBaselines>, protoId: string): number {
  const spawns = plan.actions
    .filter((a) => a.kind === "place_spawn")
    .map((a) => a.spawn);
  return spawns.filter((s) => s.type === "npc" && s.protoId === protoId).length;
}

test(
  "[contract] TownBaselinePlanner: seedTownServices enables bank/mail/auction/guildbank/inn when individual flags omitted",
  () => {
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

      // Keep unrelated baselines off so we're only testing the optional services bundle.
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

      // The thing we're testing.
      seedTownServices: true,

      // Leave guard/dummy off for deterministic expectations.
      guardCount: 0,
      dummyCount: 0,

      spawnIdMode: "legacy",
      seedBase: "seed:town_baseline",
    });

    assert.equal(countNpc(plan, "town_banker"), 1, "Expected exactly one banker NPC spawn");
    assert.equal(countNpc(plan, "town_mail_clerk"), 1, "Expected exactly one mail clerk NPC spawn");
    assert.equal(countNpc(plan, "town_auctioneer"), 1, "Expected exactly one auctioneer NPC spawn");
    assert.equal(countNpc(plan, "town_guildbank_clerk"), 1, "Expected exactly one guildbank clerk NPC spawn");
    assert.equal(countNpc(plan, "town_innkeeper"), 1, "Expected exactly one innkeeper NPC spawn");
  }
);
