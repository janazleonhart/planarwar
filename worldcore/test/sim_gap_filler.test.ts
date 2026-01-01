// worldcore/test/sim_gap_filler.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { planGapFillSpawns } from "../sim/GapFiller";
import { computeRespawnCoverage } from "../sim/RespawnCoverage";

test("GapFiller: places a checkpoint when there is a gap", () => {
  const existing: any[] = []; // no spawns at all

  const cfg = {
    seed: "seed:gapfill",
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 0, minCz: 0, maxCz: 0 },
    cellSize: 64,
    baseY: 0,
    borderMargin: 16,
    respawnRadius: 0, // only passes if we place exactly at cell center
    minDistance: 0,
    maxPlace: 5,
    spawnType: "checkpoint",
    protoId: "checkpoint",
    archetype: "checkpoint",
  } as const;

  const placed = planGapFillSpawns(existing, cfg);
  assert.ok(placed.length >= 1);

  const spawns = placed.map((p) => ({
    spawnId: p.spawnId,
    type: p.type,
    x: p.x,
    z: p.z,
    variantId: p.variantId,
  }));

  const { summary } = computeRespawnCoverage(spawns, {
    bounds: cfg.bounds,
    cellSize: cfg.cellSize,
    respawnRadius: cfg.respawnRadius,
  });

  assert.equal(summary.gapCells, 0);
});

test("GapFiller: respects minDistance between checkpoints/graveyards", () => {
  const existing = [
    { spawnId: "cp_0", type: "checkpoint", x: 32, z: 32, variantId: null }, // cell 0,0 center
  ];

  const cfg = {
    seed: "seed:gapfill",
    shardId: "prime_shard",
    bounds: { minCx: 0, maxCx: 0, minCz: 0, maxCz: 0 },
    cellSize: 64,
    baseY: 0,
    borderMargin: 16,
    respawnRadius: 0,
    minDistance: 999, // huge, should block any placement in same cell
    maxPlace: 5,
    spawnType: "checkpoint",
    protoId: "checkpoint",
    archetype: "checkpoint",
  } as const;

  const placed = planGapFillSpawns(existing as any, cfg);
  assert.equal(placed.length, 0);
});

test("GapFiller: deterministic output for same seed", () => {
  const existing: any[] = [];

  const cfg = {
    seed: "seed:gapfill",
    shardId: "prime_shard",
    bounds: { minCx: -1, maxCx: 1, minCz: -1, maxCz: 1 },
    cellSize: 64,
    baseY: 0,
    borderMargin: 16,
    respawnRadius: 80,
    minDistance: 0,
    maxPlace: 3,
    spawnType: "checkpoint",
    protoId: "checkpoint",
    archetype: "checkpoint",
  } as const;

  const a = planGapFillSpawns(existing, cfg);
  const b = planGapFillSpawns(existing, cfg);

  assert.deepEqual(a, b);
});
