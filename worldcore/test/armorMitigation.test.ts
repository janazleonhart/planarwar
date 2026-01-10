// worldcore/test/armorMitigation.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { armorMultiplier, applyArmorMitigation } from "../combat/Mitigation";

test("armorMultiplier: armor<=0 => 1.0", () => {
  assert.equal(armorMultiplier(0), 1);
  assert.equal(armorMultiplier(-50), 1);
  assert.equal(armorMultiplier(Number.NaN), 1);
});

test("armorMultiplier: default K=100 gives 50% reduction at armor=100", () => {
  // reduction = 100/(100+100)=0.5 => multiplier=0.5
  assert.equal(armorMultiplier(100), 0.5);
});

test("applyArmorMitigation: armor=100 halves damage (floored)", () => {
  assert.equal(applyArmorMitigation(100, 100), 50);
  assert.equal(applyArmorMitigation(1, 100), 0); // floored
});

test("applyArmorMitigation: minDamage clamp works", () => {
  assert.equal(applyArmorMitigation(1, 100, { minDamage: 1 }), 1);
  assert.equal(applyArmorMitigation(2, 100, { minDamage: 1 }), 1);
  assert.equal(applyArmorMitigation(3, 100, { minDamage: 1 }), 1);
});

test("armor cap: default capReduction=0.75 => multiplier >= 0.25", () => {
  const mult = armorMultiplier(999999);
  assert.ok(mult >= 0.25 && mult <= 1);
  assert.equal(applyArmorMitigation(100, 999999), 25);
});
