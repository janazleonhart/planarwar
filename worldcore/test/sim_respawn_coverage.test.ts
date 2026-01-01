// worldcore/test/sim_respawn_coverage.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { computeRespawnCoverage } from "../sim/RespawnCoverage";

test("RespawnCoverage: graveyard covers nearby cell center within radius", () => {
  const spawns = [
    { spawnId: "gy_0", type: "graveyard", x: 0, z: 0, variantId: null },
  ];

  const { rows, summary } = computeRespawnCoverage(spawns, {
    bounds: { minCx: 0, maxCx: 0, minCz: 0, maxCz: 0 },
    cellSize: 64,
    respawnRadius: 60, // center is (32,32) -> dist ~45.25
  });

  assert.equal(summary.totalCells, 1);
  assert.equal(summary.coveredCells, 1);
  assert.equal(summary.gapCells, 0);

  assert.equal(rows[0].covered, true);
  assert.equal(rows[0].nearestSpawnId, "gy_0");
  assert.ok(rows[0].nearestDistance < 60);
});

test("RespawnCoverage: cell outside radius is a gap", () => {
  const spawns = [
    { spawnId: "gy_0", type: "graveyard", x: 0, z: 0, variantId: null },
  ];

  const { rows, summary } = computeRespawnCoverage(spawns, {
    bounds: { minCx: 1, maxCx: 1, minCz: 1, maxCz: 1 },
    cellSize: 64,
    respawnRadius: 60, // center (96,96) -> dist ~135.76
  });

  assert.equal(summary.totalCells, 1);
  assert.equal(summary.coveredCells, 0);
  assert.equal(summary.gapCells, 1);

  assert.equal(rows[0].covered, false);
  assert.equal(rows[0].nearestSpawnId, "gy_0");
  assert.ok(rows[0].nearestDistance > 60);
});

test("RespawnCoverage: KOS settlement is ignored; graveyard becomes nearest eligible", () => {
  const spawns = [
    // closer, but ineligible
    { spawnId: "town_kos", type: "town", x: 30, z: 30, variantId: "kos" },
    // farther, but eligible
    { spawnId: "gy_far", type: "graveyard", x: 0, z: 0, variantId: null },
  ];

  const { rows } = computeRespawnCoverage(spawns, {
    bounds: { minCx: 0, maxCx: 0, minCz: 0, maxCz: 0 },
    cellSize: 64,
    respawnRadius: 1000,
  });

  assert.equal(rows[0].nearestSpawnId, "gy_far");
});

test("RespawnCoverage: outpost counts as settlement (eligible unless KOS)", () => {
  const spawns = [
    { spawnId: "outpost_ok", type: "outpost", x: 32, z: 32, variantId: null },
  ];

  const { rows, summary } = computeRespawnCoverage(spawns, {
    bounds: { minCx: 0, maxCx: 0, minCz: 0, maxCz: 0 },
    cellSize: 64,
    respawnRadius: 10,
  });

  assert.equal(summary.coveredCells, 1);
  assert.equal(rows[0].nearestSpawnId, "outpost_ok");
});
