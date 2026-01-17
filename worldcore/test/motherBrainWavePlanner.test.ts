// worldcore/test/motherBrainWavePlanner.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { planBrainWave } from "../sim/MotherBrainWavePlanner";

test("[motherBrain] planBrainWave is deterministic for same seed/epoch/theme", () => {
  const a = planBrainWave({
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 1, minCz: 0, maxCz: 1 },
    cellSize: 64,
    borderMargin: 16,
    seed: "seed:mother",
    epoch: 3,
    theme: "goblins",
    count: 4,
  });

  const b = planBrainWave({
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 1, minCz: 0, maxCz: 1 },
    cellSize: 64,
    borderMargin: 16,
    seed: "seed:mother",
    epoch: 3,
    theme: "goblins",
    count: 4,
  });

  assert.deepEqual(a, b);
});

test("[motherBrain] planBrainWave changes when epoch changes", () => {
  const a = planBrainWave({
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 2, minCz: 0, maxCz: 2 },
    cellSize: 64,
    borderMargin: 16,
    seed: "seed:mother",
    epoch: 1,
    theme: "bandits",
    count: 6,
  });

  const b = planBrainWave({
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 2, minCz: 0, maxCz: 2 },
    cellSize: 64,
    borderMargin: 16,
    seed: "seed:mother",
    epoch: 2,
    theme: "bandits",
    count: 6,
  });

  // simplest invariant: spawnIds differ
  assert.notDeepEqual(
    a.map((x) => x.spawn.spawnId),
    b.map((x) => x.spawn.spawnId),
  );
});

test("[motherBrain] spawnIds are brain-owned and counts are respected", () => {
  const a = planBrainWave({
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 0, minCz: 0, maxCz: 0 },
    cellSize: 64,
    borderMargin: 16,
    seed: "seed:mother",
    epoch: 0,
    theme: "rats",
    count: 10, // but only 1 cell exists
  });

  assert.equal(a.length, 1);
  assert.ok(a[0].spawn.spawnId.startsWith("brain:"));
  assert.equal(a[0].spawn.regionId, "prime_shard:0,0");
});
