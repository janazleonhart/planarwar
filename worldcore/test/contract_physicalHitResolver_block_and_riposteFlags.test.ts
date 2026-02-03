// worldcore/test/contract_physicalHitResolver_block_and_riposteFlags.test.ts
//
// Contract: PhysicalHitResolver exposes deterministic block and riposte hooks.
// - block outcome includes a damage multiplier < 1
// - parry outcome can flag riposte when allowRiposte is enabled

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

test("[contract] PhysicalHitResolver: block includes a damage multiplier", () => {
  const r = resolvePhysicalHit({
    attackerLevel: 10,
    defenderLevel: 10,
    weaponSkillPoints: 50,
    defenderCanDodge: false,
    defenderCanParry: false,
    defenderCanBlock: true,
    rng: rngSeq([0.1, 0.0]),
  });

  assert.equal(r.outcome, "block");
  assert.ok(
    r.blockMultiplier > 0 && r.blockMultiplier < 1,
    `expected blockMultiplier in (0,1), got ${r.blockMultiplier}`,
  );
});

test("[contract] PhysicalHitResolver: parry can flag riposte", () => {
  const r = resolvePhysicalHit({
    attackerLevel: 10,
    defenderLevel: 10,
    weaponSkillPoints: 50,
    defenderCanDodge: false,
    defenderCanParry: true,
    defenderCanBlock: false,
    allowRiposte: true,
    rng: rngSeq([0.1, 0.0]),
  });

  assert.equal(r.outcome, "parry");
  assert.equal(r.riposte, true);
  assert.equal(r.blockMultiplier, 1);
});
