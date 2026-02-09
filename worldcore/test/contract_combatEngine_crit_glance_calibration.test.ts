// worldcore/test/contract_combatEngine_crit_glance_calibration.test.ts
//
// Contract: Crit/glance checks consume RNG in a stable order:
// 1) roll (damage variance)
// 2) critRoll
// 3) glanceRoll
//
// And precedence is stable: glancing overrides crit.
//
// This protects deterministic simulations/tests from accidental extra RNG draws.

import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSource(): any {
  return {
    char: { id: "c1", classId: "outrider", level: 10, attributes: { str: 20, int: 10 } },
    effective: { str: 20, int: 10 },
    channel: "weapon",
    weaponSkill: "ranged",
  };
}

function makeTarget(): any {
  return { entity: { id: "t1", name: "Target", type: "npc" }, armor: 0, resist: {} };
}

test("[contract] CombatEngine: crit/glance RNG stream is stable across 1000 swings", () => {
  const critChance = 0.2;
  const glancingChance = 0.1;

  const seed = 0xdecafbad;
  const rng = mulberry32(seed);

  let expectedCrit = 0;
  let expectedGlance = 0;
  let actualCrit = 0;
  let actualGlance = 0;

  for (let i = 0; i < 1000; i++) {
    // Expected draws:
    const _roll = rng(); // damage variance (we don't care about its value)
    const critRoll = rng();
    const glanceRoll = rng();

    const expGlance = glanceRoll < glancingChance;
    const expCrit = !expGlance && critRoll < critChance;

    if (expCrit) expectedCrit++;
    if (expGlance) expectedGlance++;

    // Rewind is not possible; instead we run a second generator in lockstep.
    // So we compute actuals using a mirrored generator.
  }

  // Use a second generator with the same seed to drive CombatEngine.
  const rng2 = mulberry32(seed);
  for (let i = 0; i < 1000; i++) {
    const res = computeDamage(makeSource(), makeTarget(), {
      rng: rng2,
      critChance,
      glancingChance,
      disableParry: true,
      disableBlock: true,
    });

    // Precedence safety rail:
    if (res.wasGlancing) {
      assert.equal(res.wasCrit, false, "glancing hits must not crit");
    }

    if (res.wasCrit) actualCrit++;
    if (res.wasGlancing) actualGlance++;
  }

  assert.equal(actualCrit, expectedCrit, `crit count mismatch (expected=${expectedCrit}, actual=${actualCrit})`);
  assert.equal(
    actualGlance,
    expectedGlance,
    `glance count mismatch (expected=${expectedGlance}, actual=${actualGlance})`,
  );
});
