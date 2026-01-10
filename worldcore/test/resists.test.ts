// worldcore/test/resists.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { resistMultiplier, applyResistMitigation } from "../combat/Resists";

test("resistMultiplier: resist<=0 => 1.0", () => {
  assert.equal(resistMultiplier(0), 1);
  assert.equal(resistMultiplier(-25), 1);
  assert.equal(resistMultiplier(Number.NaN), 1);
});

test("resistMultiplier: default K=200 maps resist=100 to 50% reduction", () => {
  // reduction = 100/200 = 0.5 => multiplier = 0.5
  assert.equal(resistMultiplier(100), 0.5);
});

test("resist cap: default capReduction=0.75 => multiplier bottoms at 0.25", () => {
  assert.equal(resistMultiplier(200), 0.25); // would be 1.0 reduction, capped to 0.75
  assert.equal(resistMultiplier(999999), 0.25);
});

test("applyResistMitigation: floored + minDamage clamp", () => {
  assert.equal(applyResistMitigation(10, 100), 5);
  assert.equal(applyResistMitigation(1, 100), 0);
  assert.equal(applyResistMitigation(1, 100, { minDamage: 1 }), 1);
});
