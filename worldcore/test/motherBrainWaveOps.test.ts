// worldcore/test/motherBrainWaveOps.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { planBrainWave } from "../sim/MotherBrainWavePlanner";
import { computeBrainWaveApplyPlan, computeBrainWipePlan } from "../sim/MotherBrainWaveOps";

test("[motherBrain] computeBrainWaveApplyPlan is idempotent when spawn_ids already exist", () => {
  const plannedActions = planBrainWave({
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 1, minCz: 0, maxCz: 1 },
    cellSize: 64,
    borderMargin: 16,
    seed: "seed:mother",
    epoch: 0,
    theme: "goblins",
    count: 4,
  });

  const plannedIds = plannedActions.map((a) => a.spawn.spawnId);

  const plan = computeBrainWaveApplyPlan({
    plannedActions,
    existingSpawnIds: plannedIds, // all exist
    existingBrainSpawnIdsInBox: plannedIds,
    append: true,
    updateExisting: false,
  });

  assert.equal(plan.uniquePlanned, 4);
  assert.equal(plan.wouldDelete, 0);
  assert.equal(plan.wouldInsert, 0);
  assert.equal(plan.wouldUpdate, 0);
  assert.equal(plan.wouldSkip, 4);
  assert.equal(plan.duplicatePlanned, 0);
});

test("[motherBrain] computeBrainWaveApplyPlan replace-mode deletes existing brain spawns", () => {
  const plannedActions = planBrainWave({
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 0, minCz: 0, maxCz: 0 },
    cellSize: 64,
    borderMargin: 16,
    seed: "seed:mother",
    epoch: 1,
    theme: "rats",
    count: 1,
  });

  const existingBrain = [
    "brain:0:goblins:aaa",
    "brain:0:goblins:bbb",
    "brain:1:rats:ccc",
  ];

  const plan = computeBrainWaveApplyPlan({
    plannedActions,
    existingSpawnIds: [],
    existingBrainSpawnIdsInBox: existingBrain,
    append: false,
    updateExisting: false,
  });

  assert.equal(plan.wouldDelete, 3);
});

test("[motherBrain] computeBrainWipePlan filters by theme and epoch", () => {
  const existingBrain = [
    "brain:0:goblins:aaa",
    "brain:1:goblins:bbb",
    "brain:0:bandits:ccc",
    "brain:wave:slimes:5:ddd", // unknown theme to parser
  ];

  {
    const p = computeBrainWipePlan({
      existingBrainSpawnIdsInBox: existingBrain,
      theme: "goblins",
      epoch: 0,
    });
    assert.deepEqual(p.selected, ["brain:0:goblins:aaa"]);
    assert.equal(p.wouldDelete, 1);
  }

  {
    // unknown theme should still match via token includes
    const p = computeBrainWipePlan({
      existingBrainSpawnIdsInBox: existingBrain,
      theme: "slimes",
      epoch: 5,
    });
    assert.deepEqual(p.selected, ["brain:wave:slimes:5:ddd"]);
    assert.equal(p.wouldDelete, 1);
  }
});
