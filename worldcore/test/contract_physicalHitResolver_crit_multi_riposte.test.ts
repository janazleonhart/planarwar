// worldcore/test/contract_physicalHitResolver_crit_multi_riposte.test.ts
//
// Contract: physical hit resolver can produce parry->riposte and crit+triple outcomes deterministically.

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

test("[contract] PhysicalHitResolver: deterministic multi-strike + parry->riposte flag", () => {
  // Force triple attack by choosing rMulti below tripleChance (at familiarity=1 => ~0.05).
  const triple = resolvePhysicalHit({
    attackerLevel: 20,
    defenderLevel: 20,
    weaponSkillPoints: 100, // cap = 100, familiarity=1
    rng: rngSeq([
      0.01, // hit roll (hit)
      0.99, // avoid roll (no dodge/parry/block)
      0.01, // multi roll (triple)
    ]),
  });

  assert.equal(triple.outcome, "hit");
  assert.equal(triple.strikes, 3);

  // Force parry by placing rAvoid inside the parry band.
  // At defenderLevel=10: dodge ~0.045, parry adds ~0.03 => parry band ~[0.045, 0.075)
  const parry = resolvePhysicalHit({
    attackerLevel: 10,
    defenderLevel: 10,
    weaponSkillPoints: 50, // cap=50, familiarity=1
    rng: rngSeq([
      0.01, // hit roll (hit)
      0.06, // avoid roll (parry)
    ]),
    allowRiposte: true,
  });

  assert.equal(parry.outcome, "parry");
  assert.equal(parry.riposte, true);
});
