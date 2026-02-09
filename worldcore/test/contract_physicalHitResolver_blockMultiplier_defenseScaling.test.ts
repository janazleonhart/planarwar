// worldcore/test/contract_physicalHitResolver_blockMultiplier_defenseScaling.test.ts
//
// Contract: block mitigation scales with defender defense skill / experience.
// A more skilled defender should produce a *lower* blockMultiplier (stronger block).

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

test("[contract] PhysicalHitResolver: blockMultiplier decreases with higher defender defense skill", () => {
  // Force a block outcome deterministically:
  // - rHit = 0.01 => hit passes
  // - rAvoid = 0.00 => falls into block band (with dodge/parry disabled)
  const attackerLevel = 20;
  const defenderLevel = 20;
  const weaponSkillPoints = attackerLevel * 5;

  const low = resolvePhysicalHit({
    attackerLevel,
    defenderLevel,
    weaponSkillPoints,
    defenderDefenseSkillPoints: 0,
    defenderCanDodge: false,
    defenderCanParry: false,
    defenderCanBlock: true,
    allowCrit: false,
    allowMultiStrike: false,
    rng: rngSeq([0.01, 0.0]),
  });

  const high = resolvePhysicalHit({
    attackerLevel,
    defenderLevel,
    weaponSkillPoints,
    defenderDefenseSkillPoints: defenderLevel * 5,
    defenderCanDodge: false,
    defenderCanParry: false,
    defenderCanBlock: true,
    allowCrit: false,
    allowMultiStrike: false,
    rng: rngSeq([0.01, 0.0]),
  });

  assert.equal(low.outcome, "block");
  assert.equal(high.outcome, "block");

  assert.ok(low.blockMultiplier > 0 && low.blockMultiplier < 1);
  assert.ok(high.blockMultiplier > 0 && high.blockMultiplier < 1);

  assert.ok(
    high.blockMultiplier < low.blockMultiplier,
    `expected high defense blockMultiplier (${high.blockMultiplier}) < low defense (${low.blockMultiplier})`,
  );
});
