// worldcore/test/sim_settlement_planner.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { planInitialOutposts } from "../sim/SettlementPlanner";
import { parseRegionId, cellBounds } from "../sim/SimGrid";

test("SettlementPlanner: deterministic output for same seed", () => {
  const factions = [
    { factionId: "emberfall", count: 2 },
    { factionId: "oathbound", count: 2 },
  ] as const;

  const cfg = {
    seed: "seed:alpha",
    shardId: "prime_shard",
    bounds: { minCx: -4, maxCx: 4, minCz: -4, maxCz: 4 },
    cellSize: 64,
    baseY: 0,
    borderMargin: 16,
    minCellDistance: 3,
    spawnType: "outpost",
    protoId: "outpost",
    archetype: "outpost",
  } as const;

  const a = planInitialOutposts(factions, cfg);
  const b = planInitialOutposts(factions, cfg);

  assert.deepEqual(a, b);
});

test("SettlementPlanner: respects minCellDistance spacing (euclidean)", () => {
  const factions = [
    { factionId: "f1", count: 3 },
    { factionId: "f2", count: 3 },
  ] as const;

  const cfg = {
    seed: "seed:spacing",
    shardId: "prime_shard",
    bounds: { minCx: -6, maxCx: 6, minCz: -6, maxCz: 6 },
    cellSize: 64,
    baseY: 0,
    borderMargin: 16,
    minCellDistance: 3,
    spawnType: "outpost",
    protoId: "outpost",
    archetype: "outpost",
  } as const;

  const actions = planInitialOutposts(factions, cfg);
  const cells = actions
    .filter((a) => a.kind === "place_spawn")
    .map((a) => {
      const rid = a.spawn.regionId;
      assert.ok(rid, "regionId should be set for placed outposts");
      const parsed = parseRegionId(rid);
      assert.ok(parsed, "regionId should parse");
      return parsed!.cell;
    });

  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const dx = cells[i].cx - cells[j].cx;
      const dz = cells[i].cz - cells[j].cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      assert.ok(
        d >= cfg.minCellDistance,
        `outposts too close: (${cells[i].cx},${cells[i].cz}) vs (${cells[j].cx},${cells[j].cz}) d=${d}`,
      );
    }
  }
});

test("SettlementPlanner: produces requested counts per faction (when space allows)", () => {
  const factions = [
    { factionId: "A", count: 2 },
    { factionId: "B", count: 1 },
    { factionId: "C", count: 3 },
  ] as const;

  const cfg = {
    seed: 1337,
    shardId: "prime_shard",
    bounds: { minCx: -8, maxCx: 8, minCz: -8, maxCz: 8 },
    cellSize: 64,
    baseY: 0,
    borderMargin: 16,
    minCellDistance: 2,
    spawnType: "outpost",
    protoId: "outpost",
    archetype: "outpost",
  } as const;

  const actions = planInitialOutposts(factions, cfg);

  const byFaction: Record<string, number> = {};
  for (const a of actions) {
    if (a.kind !== "place_spawn") continue;
    const factionId = String((a.spawn.meta as any)?.factionId ?? "");
    byFaction[factionId] = (byFaction[factionId] ?? 0) + 1;
  }

  assert.equal(byFaction["A"], 2);
  assert.equal(byFaction["B"], 1);
  assert.equal(byFaction["C"], 3);
});

test("SettlementPlanner: spawn coordinates stay inside cell bounds with borderMargin", () => {
  const factions = [{ factionId: "border_test", count: 5 }] as const;

  const cfg = {
    seed: "seed:border",
    shardId: "prime_shard",
    bounds: { minCx: -3, maxCx: 3, minCz: -3, maxCz: 3 },
    cellSize: 64,
    baseY: 0,
    borderMargin: 16,
    minCellDistance: 1,
    spawnType: "outpost",
    protoId: "outpost",
    archetype: "outpost",
  } as const;

  const actions = planInitialOutposts(factions, cfg);

  for (const a of actions) {
    if (a.kind !== "place_spawn") continue;
    const rid = a.spawn.regionId!;
    const parsed = parseRegionId(rid)!;
    const cb = cellBounds(parsed.cell, cfg.cellSize);

    assert.ok(a.spawn.x >= cb.minX + cfg.borderMargin);
    assert.ok(a.spawn.x <= cb.maxX - cfg.borderMargin);
    assert.ok(a.spawn.z >= cb.minZ + cfg.borderMargin);
    assert.ok(a.spawn.z <= cb.maxZ - cfg.borderMargin);
  }
});
