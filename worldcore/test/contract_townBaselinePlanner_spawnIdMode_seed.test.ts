// worldcore/test/contract_townBaselinePlanner_spawnIdMode_seed.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { planTownBaselines } from "../sim/TownBaselinePlanner";

type Spawn = { spawnId: string; type: string; protoId?: string | null };

function getNpcSpawns(plan: ReturnType<typeof planTownBaselines>): Spawn[] {
  const spawns = plan.actions
    .filter((a) => a.kind === "place_spawn")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((a: any) => a.spawn as any);

  return spawns
    .filter((s: any) => String(s.type) === "npc")
    .map((s: any) => ({
      spawnId: String(s.spawnId),
      type: String(s.type),
      protoId: s.protoId != null ? String(s.protoId) : null,
    }));
}

test(
  "[contract] TownBaselinePlanner: spawnIdMode=seed uses seed:<base>:<town>:<kind> ids for service anchors",
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

      // Keep unrelated baselines off so we're testing ids only.
      seedMailbox: false,
      seedRest: false,
      seedStations: false,
      stationProtoIds: [],

      seedVendors: false,
      vendorCount: 0,
      vendorProtoId: "starter_alchemist",

      // Include trainer + optional services.
      seedTrainers: true,
      trainerCount: 1,
      trainerProtoId: "town_trainer",

      seedTownServices: true,

      // Deterministic expectations.
      guardCount: 0,
      dummyCount: 0,

      spawnIdMode: "seed",
      seedBase: "seed:town_baseline",
    });

    const ids = getNpcSpawns(plan).map((s) => s.spawnId);

    const prefix = "seed:town_baseline:town_test_1:";

    assert.ok(ids.includes(prefix + "trainer_1"), `Expected ${prefix}trainer_1, got: ${ids.join(", ")}`);
    assert.ok(ids.includes(prefix + "bank_1"), `Expected ${prefix}bank_1, got: ${ids.join(", ")}`);
    assert.ok(ids.includes(prefix + "mail_1"), `Expected ${prefix}mail_1, got: ${ids.join(", ")}`);
    assert.ok(ids.includes(prefix + "auction_1"), `Expected ${prefix}auction_1, got: ${ids.join(", ")}`);
    assert.ok(ids.includes(prefix + "guildbank_1"), `Expected ${prefix}guildbank_1, got: ${ids.join(", ")}`);
    assert.ok(ids.includes(prefix + "inn_1"), `Expected ${prefix}inn_1, got: ${ids.join(", ")}`);
  },
);
