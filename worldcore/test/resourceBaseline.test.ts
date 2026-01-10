// worldcore/test/resourceBaseline.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultResourceConfig,
  planResourceBaselineForRegion,
  planResourceBaselinesForWorld,
  type RegionSnapshot,
  type RegionSpawnSnapshot,
} from "../sim/ResourceBaselineModule";

import type { PlaceSpawnAction } from "../sim/BrainActions";

function makeRegion(
  overrides: Partial<RegionSnapshot> = {},
  spawns: RegionSpawnSnapshot[] = [],
): RegionSnapshot {
  return {
    regionId: "prime_shard:0,0",
    shardId: "prime_shard",
    cellX: 0,
    cellZ: 0,
    baseTier: 1,
    dangerTier: 1,
    spawns,
    settlements: [],
    ...overrides,
  };
}

test("ResourceBaseline: safe region gets at least one node per resource", () => {
  const cfg = buildDefaultResourceConfig("TEST_SAFE");
  const region = makeRegion();

  const plan = planResourceBaselineForRegion(region, cfg);
  const actions: PlaceSpawnAction[] = plan.actions;

  // We should have at least one spawn per resource prototype.
  assert.equal(actions.length, cfg.resources.length);

  for (const res of cfg.resources) {
    const matching = actions.filter(
      (a) => a.spawn.variantId === res.variantId && a.spawn.type === res.type,
    );
    assert.ok(
      matching.length >= 1,
      `Expected at least one node for ${res.kind} (${res.variantId})`,
    );
    for (const a of matching) {
      assert.equal(a.spawn.regionId, region.regionId);
      assert.equal(a.spawn.shardId, region.shardId);
    }
  }
});

test("ResourceBaseline: danger tier increases node count where configured", () => {
  const cfg = buildDefaultResourceConfig("TEST_TIERS");

  const safeRegion = makeRegion();
  const dangerousRegion = makeRegion({
    dangerTier: 4,
  });

  const safePlan = planResourceBaselineForRegion(safeRegion, cfg);
  const dangerPlan = planResourceBaselineForRegion(dangerousRegion, cfg);

  const countByVariant = (actions: PlaceSpawnAction[], variant: string) =>
    actions.filter((a) => a.spawn.variantId === variant).length;

  const manaSafe = countByVariant(safePlan.actions, "mana_spark_arcane");
  const manaDanger = countByVariant(dangerPlan.actions, "mana_spark_arcane");

  // Mana nodes have a strong danger scaling; dangerRegion should have strictly more.
  assert.ok(
    manaDanger > manaSafe,
    `Expected more mana nodes in dangerous region (safe=${manaSafe}, danger=${manaDanger})`,
  );
});

test("ResourceBaseline: respects existing nodes and does not over-place", () => {
  const cfg = buildDefaultResourceConfig("TEST_EXISTING");

  // Pretend we already have plenty of ore nodes.
  const existingOre: RegionSpawnSnapshot = {
    spawnId: "existing_ore_1",
    type: "resource",
    archetype: "ore_node",
    protoId: "ore_iron_hematite",
    variantId: "ore_iron_hematite",
    x: 0,
    z: 0,
  };

  const region = makeRegion({}, [
    existingOre,
    { ...existingOre, spawnId: "existing_ore_2", x: 5 },
    { ...existingOre, spawnId: "existing_ore_3", x: 10 },
  ]);

  const plan = planResourceBaselineForRegion(region, cfg);

  const oreRes = cfg.resources.find(
    (r) => r.variantId === "ore_iron_hematite",
  );
  assert.ok(oreRes, "expected ore resource config");

  const target =
    oreRes.perSafeRegion +
    oreRes.perTown * region.settlements.length +
    oreRes.perDangerTier * Math.max(0, region.dangerTier - region.baseTier);

  const existingCount = 3; // we created three ore nodes above

  const placedOre = plan.actions.filter(
    (a) => a.spawn.variantId === "ore_iron_hematite",
  ).length;

  const expectedToPlace = Math.max(0, target - existingCount);

  assert.equal(
    placedOre,
    expectedToPlace,
    `Planner should place exactly max(0, target - existing) ore nodes (existing=${existingCount}, target=${target})`,
  );
});

test("ResourceBaseline: world planner just flattens all region plans", () => {
  const cfg = buildDefaultResourceConfig("TEST_WORLD");

  const r1 = makeRegion({ regionId: "prime_shard:0,0", cellX: 0, cellZ: 0 });
  const r2 = makeRegion({ regionId: "prime_shard:1,0", cellX: 1, cellZ: 0 });

  const worldPlan = planResourceBaselinesForWorld([r1, r2], cfg);

  // Should have a summary per region.
  assert.equal(worldPlan.regions.length, 2);

  const totalFromSummaries = worldPlan.regions.reduce(
    (sum, r) => sum + r.totalPlaced,
    0,
  );

  assert.equal(
    worldPlan.actions.length,
    totalFromSummaries,
    "actions length should match sum of per-region totals",
  );
});
