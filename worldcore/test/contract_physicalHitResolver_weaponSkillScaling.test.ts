// worldcore/test/contract_physicalHitResolver_weaponSkillScaling.test.ts
//
// Contract: physical hit resolution depends on weapon skill and level.
// - Low-level characters can still land hits with untrained weapons vs near-level mobs.
// - High-level characters with totally untrained weapons miss substantially more vs equal-level mobs.
// - Trained weapon skill restores reliable hit chance.

import test from "node:test";
import assert from "node:assert/strict";

import { resolvePhysicalHit } from "../combat/PhysicalHitResolver";

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

test("[contract] PhysicalHitResolver: weapon skill + level scaling affects hit chance", () => {
  // L1, untrained vs L3: should usually hit (RNG-based).
  const low = resolvePhysicalHit({
    attackerLevel: 1,
    defenderLevel: 3,
    weaponSkillPoints: 0,
    rng: rngSeq([0.5, 0.99, 0.99]),
  });
  assert.equal(low.outcome, "hit", `expected hit at low level vs low mob, got ${low.outcome} (hitChance=${low.hitChance})`);

  // L50, untrained vs L50: should miss a lot.
  const highUntrained = resolvePhysicalHit({
    attackerLevel: 50,
    defenderLevel: 50,
    weaponSkillPoints: 0,
    rng: rngSeq([0.5]),
  });
  assert.equal(highUntrained.outcome, "miss", `expected miss when high-level and untrained, got ${highUntrained.outcome} (hitChance=${highUntrained.hitChance})`);

  // L50, trained vs L50: should hit reliably.
  const highTrained = resolvePhysicalHit({
    attackerLevel: 50,
    defenderLevel: 50,
    weaponSkillPoints: 250, // level*5 full training
    rng: rngSeq([0.5, 0.99, 0.99]),
  });
  assert.equal(highTrained.outcome, "hit", `expected hit when trained, got ${highTrained.outcome} (hitChance=${highTrained.hitChance})`);
});
