// worldcore/test/contract_physicalHitResolver_blockMultiplier_calibration.test.ts
//
// Contract: block mitigation calibration.
// - blockMultiplier is bounded and monotonic with defense skill.
// - higher defender level modestly improves block (lower multiplier).

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

function forceBlock({ attackerLevel, defenderLevel, defenderDefenseSkillPoints }: {
  attackerLevel: number;
  defenderLevel: number;
  defenderDefenseSkillPoints: number;
}) {
  return resolvePhysicalHit({
    attackerLevel,
    defenderLevel,
    weaponSkillPoints: attackerLevel * 5,
    defenderDefenseSkillPoints,
    defenderCanDodge: false,
    defenderCanParry: false,
    defenderCanBlock: true,
    allowCrit: false,
    allowMultiStrike: false,
    rng: rngSeq([0.01, 0.0]),
  });
}

test("[contract] PhysicalHitResolver: blockMultiplier is bounded and monotonic (defense)", () => {
  const attackerLevel = 20;
  const defenderLevel = 20;

  const low = forceBlock({ attackerLevel, defenderLevel, defenderDefenseSkillPoints: 0 });
  const mid = forceBlock({ attackerLevel, defenderLevel, defenderDefenseSkillPoints: (defenderLevel * 5) / 2 });
  const high = forceBlock({ attackerLevel, defenderLevel, defenderDefenseSkillPoints: defenderLevel * 5 });

  for (const r of [low, mid, high]) {
    assert.equal(r.outcome, "block");
    assert.ok(r.blockMultiplier > 0 && r.blockMultiplier < 1);
    // hard bounds (should match resolver clamp semantics)
    assert.ok(r.blockMultiplier >= 0.35 && r.blockMultiplier <= 0.90);
  }

  assert.ok(mid.blockMultiplier < low.blockMultiplier, `expected mid (${mid.blockMultiplier}) < low (${low.blockMultiplier})`);
  assert.ok(high.blockMultiplier < mid.blockMultiplier, `expected high (${high.blockMultiplier}) < mid (${mid.blockMultiplier})`);
});

test("[contract] PhysicalHitResolver: higher defender level modestly improves block", () => {
  const attackerLevel = 20;

  const equal = forceBlock({ attackerLevel, defenderLevel: 20, defenderDefenseSkillPoints: 20 * 5 });
  const higher = forceBlock({ attackerLevel, defenderLevel: 25, defenderDefenseSkillPoints: 25 * 5 });

  assert.equal(equal.outcome, "block");
  assert.equal(higher.outcome, "block");

  assert.ok(
    higher.blockMultiplier < equal.blockMultiplier,
    `expected higher-level defender to block better: ${higher.blockMultiplier} < ${equal.blockMultiplier}`,
  );
});
