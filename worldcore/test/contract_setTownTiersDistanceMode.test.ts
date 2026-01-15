// worldcore/test/contract_setTownTiersDistanceMode.test.ts
//
// Contract: distance-mode tier assignment is deterministic and bucketed.
//
// This test is pure (no DB). It locks in the mapping used by simBrain's
// set-town-tiers command so we can't accidentally invert tiers later.

import test from "node:test";
import assert from "node:assert/strict";

import { tierFromNormalizedDistance } from "../sim/TownTierSeeding";

test("[contract] tierFromNormalizedDistance maps center to maxTier", () => {
  assert.equal(tierFromNormalizedDistance(0, 1, 4), 4);
  assert.equal(tierFromNormalizedDistance(0.0001, 1, 4), 4);
});

test("[contract] tierFromNormalizedDistance maps edge to minTier", () => {
  assert.equal(tierFromNormalizedDistance(1, 1, 4), 1);
  assert.equal(tierFromNormalizedDistance(0.9999, 1, 4), 1);
});

test("[contract] tierFromNormalizedDistance buckets evenly across tiers", () => {
  // buckets for 1..4 are width 0.25:
  // [0..0.25) => 4
  // [0.25..0.5) => 3
  // [0.5..0.75) => 2
  // [0.75..1] => 1
  assert.equal(tierFromNormalizedDistance(0.10, 1, 4), 4);
  assert.equal(tierFromNormalizedDistance(0.26, 1, 4), 3);
  assert.equal(tierFromNormalizedDistance(0.51, 1, 4), 2);
  assert.equal(tierFromNormalizedDistance(0.76, 1, 4), 1);
});

test("[contract] clamps and normalizes bad inputs", () => {
  assert.equal(tierFromNormalizedDistance(-123, 1, 4), 4);
  assert.equal(tierFromNormalizedDistance(123, 1, 4), 1);
  assert.equal(tierFromNormalizedDistance(Number.NaN, 1, 4), 4);
});
