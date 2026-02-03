// worldcore/test/contract_weaponSkill_progression_cap_and_effect.test.ts
//
// Contract: weapon skill points progress with non-trivial swing attempts,
// are capped by level, and materially affect physical hit outcomes.

import test from "node:test";
import assert from "node:assert/strict";

import type { CharacterState } from "../characters/CharacterTypes";
import { gainWeaponSkill, getWeaponSkill } from "../skills/SkillProgression";
import {
  computeWeaponSkillGainOnSwingAttempt,
  getWeaponSkillCapPoints,
} from "../combat/CombatScaling";
import { resolvePhysicalHit } from "../combat/PhysicalHitResolver";

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

test("[contract] weapon skill: non-trivial attempts train, cap enforced, affects hit outcome", () => {
  const char: CharacterState = {
    id: "c1",
    shardId: "prime_shard",
    name: "Tester",
    classId: 1,
    level: 20,
    xp: 0,
    attributes: {} as any,
    inventory: [] as any,
    progression: {},
  } as any;

  const cap = getWeaponSkillCapPoints(char);
  assert.equal(cap, 100, "level 20 cap should be 100 points (level*5)");

  // Trivial target (10+ levels below) should not train.
  const gainTrivial = computeWeaponSkillGainOnSwingAttempt({
    attackerLevel: 20,
    defenderLevel: 5,
    currentPoints: 0,
    capPoints: cap,
    didHit: false,
  });
  assert.equal(gainTrivial, 0, "trivial targets should not train weapon skills");

  // Equal-level target should train.
  const gainEqual = computeWeaponSkillGainOnSwingAttempt({
    attackerLevel: 20,
    defenderLevel: 20,
    currentPoints: 0,
    capPoints: cap,
    didHit: false,
  });
  assert.ok(gainEqual > 0, "equal-level swing attempts should train weapon skills");

  // Train up via repeated attempts (deterministic policy) and ensure the cap is enforced.
  for (let i = 0; i < 500; i++) {
    const current = getWeaponSkill(char, "one_handed");
    const gain = computeWeaponSkillGainOnSwingAttempt({
      attackerLevel: 20,
      defenderLevel: 20,
      currentPoints: current,
      capPoints: cap,
      didHit: true,
    });
    gainWeaponSkill(char, "one_handed", gain);
  }

  const trained = getWeaponSkill(char, "one_handed");
  assert.ok(trained > 0, "skill should increase with repeated swing attempts");
  assert.ok(trained <= cap, "skill must not exceed cap");

  // Hit outcome should change for the same roll when fully trained vs untrained.
  const untrainedResult = resolvePhysicalHit({
    attackerLevel: 20,
    defenderLevel: 20,
    weaponSkillPoints: 0,
    rng: rngSeq([0.65, 0.99, 0.99]),
  });
  assert.equal(untrainedResult.outcome, "miss", "untrained should miss at this rHit");

  const trainedResult = resolvePhysicalHit({
    attackerLevel: 20,
    defenderLevel: 20,
    weaponSkillPoints: cap,
    rng: rngSeq([0.65, 0.99, 0.99]),
  });
  assert.equal(trainedResult.outcome, "hit", "trained should hit at this rHit");
});
