// worldcore/test/contract_physicalHitResolver_defenseSkillInfluence.test.ts
//
// Contract: defender defense skill meaningfully increases avoidance probability
// in the physical hit resolver (deterministically, for tests).
//
// We force RNG values so the only difference between the two cases is
// defenderDefenseSkillPoints.

import test from "node:test";
import assert from "node:assert/strict";

import { resolvePhysicalHit } from "../combat/PhysicalHitResolver";

function seqRng(values: number[]) {
  let i = 0;
  return () => {
    const v = values[i] ?? values[values.length - 1] ?? 0;
    i += 1;
    return v;
  };
}

test("[contract] defense skill increases dodge chance deterministically", () => {
  const attackerLevel = 10;
  const defenderLevel = 10;

  // Make sure we always pass the hit roll, then test avoidance with rAvoid=0.08.
  // With defense=0, dodgeChance should be below 0.08 => no dodge.
  // With high defense, dodgeChance should exceed 0.08 => dodge.
  const baseReq: any = {
    attackerLevel,
    defenderLevel,
    weaponSkillPoints: attackerLevel * 5,
    defenderCanDodge: true,
    defenderCanParry: false,
    defenderCanBlock: false,
    allowCrit: false,
    allowMultiStrike: false,
    allowRiposte: false,
  };

  const rHit = 0.01;
  const rAvoid = 0.08;

  const noDefense = resolvePhysicalHit({
    ...baseReq,
    defenderDefenseSkillPoints: 0,
    rng: seqRng([rHit, rAvoid]),
  });

  const highDefense = resolvePhysicalHit({
    ...baseReq,
    defenderDefenseSkillPoints: defenderLevel * 5,
    rng: seqRng([rHit, rAvoid]),
  });

  assert.equal(noDefense.outcome, "hit", "no defense -> should not dodge at this rAvoid");
  assert.equal(highDefense.outcome, "dodge", "high defense -> should dodge at this rAvoid");
});
