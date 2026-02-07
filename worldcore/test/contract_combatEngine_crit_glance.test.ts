// worldcore/test/contract_combatEngine_crit_glance.test.ts
//
// Contract: CombatEngine crit + glancing logic is deterministic, precedence is explicit,
// and multipliers apply only when intended.

import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

function makeSource(channel: "weapon" | "spell" | "ability" = "weapon"): any {
  return {
    char: { id: "c1", classId: "outrider", level: 10, attributes: { str: 20, int: 10 } },
    effective: { str: 20, int: 10 },
    channel,
    weaponSkill: "ranged",
    spellSchool: "arcane",
  };
}

function makeTarget(): any {
  return { entity: { id: "t1", name: "Target", type: "npc" }, armor: 0, resist: {} };
}

test("[contract] CombatEngine: forceCrit increases damage deterministically (no glancing)", () => {
  process.env.PW_CRIT_MULTIPLIER = "2.0";
  process.env.PW_GLANCE_MULTIPLIER = "0.7";

  const base = computeDamage(makeSource("weapon"), makeTarget(), {
    rng: rngSeq([0.50, 0.10, 0.10]), // roll, critRoll, glanceRoll
    disableCrit: true,
    disableGlancing: true,
  });

  const crit = computeDamage(makeSource("weapon"), makeTarget(), {
    rng: rngSeq([0.50, 0.10, 0.10]),
    forceCrit: true,
    disableGlancing: true,
  });

  assert.equal(base.wasCrit, false);
  assert.equal(base.wasGlancing, false);
  assert.equal(crit.wasCrit, true);
  assert.equal(crit.wasGlancing, false);
  assert.ok(
    crit.damage > base.damage,
    `expected crit damage > base (base=${base.damage}, crit=${crit.damage})`,
  );
});

test("[contract] CombatEngine: glancing overrides crit when both succeed (weapon channel)", () => {
  process.env.PW_CRIT_MULTIPLIER = "2.0";
  process.env.PW_GLANCE_MULTIPLIER = "0.5";

  const normal = computeDamage(makeSource("weapon"), makeTarget(), {
    rng: rngSeq([0.50, 0.10, 0.10]),
    disableCrit: true,
    disableGlancing: true,
  });

  const both = computeDamage(makeSource("weapon"), makeTarget(), {
    rng: rngSeq([0.50, 0.00, 0.00]),
    critChance: 1,
    glancingChance: 1,
  });

  assert.equal(both.wasGlancing, true);
  assert.equal(both.wasCrit, false);
  assert.ok(
    both.damage < normal.damage,
    `expected glancing damage < normal (normal=${normal.damage}, glance=${both.damage})`,
  );
});

test("[contract] CombatEngine: glancing does not apply to spell channel even when chance is 1", () => {
  const spell = computeDamage(makeSource("spell"), makeTarget(), {
    rng: rngSeq([0.50, 0.00, 0.00]),
    critChance: 0,
    glancingChance: 1,
  });

  assert.equal(spell.wasGlancing, false);
});
