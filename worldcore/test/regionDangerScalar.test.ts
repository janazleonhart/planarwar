// worldcore/test/regionDangerScalar.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  getRegionDangerAuraStrengthForTier,
  scaleDamageTakenPct,
} from "../combat/RegionDangerAuras";

test("RegionDangerAura: tier < threshold => 0 (even with scalar)", () => {
  const base = getRegionDangerAuraStrengthForTier(2 as any);
  assert.equal(base, 0);

  const scaled = scaleDamageTakenPct(base, 10);
  assert.equal(scaled, 0);
});

test("RegionDangerAura: dangerScalar multiplies damageTakenPct", () => {
  const base = getRegionDangerAuraStrengthForTier(3 as any);
  assert.equal(base, 0.05);

  const scaled = scaleDamageTakenPct(base, 1.25);
  assert.equal(scaled, 0.0625);
});

test("RegionDangerAura: scaleDamageTakenPct clamps to safety max", () => {
  const scaled = scaleDamageTakenPct(0.8, 10);
  assert.equal(scaled, 0.95);
});

test("RegionDangerAura: invalid scalar treated as 1", () => {
  assert.equal(scaleDamageTakenPct(0.05, 0), 0.05);
  assert.equal(scaleDamageTakenPct(0.05, Number.NaN), 0.05);
  assert.equal(scaleDamageTakenPct(0.05, Number.POSITIVE_INFINITY), 0.05);
});
