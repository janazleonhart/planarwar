// worldcore/test/minDamageRule.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { applyStatusEffect } from "../combat/StatusEffects";

test("min-damage rule: positive fractional damage becomes at least 1", () => {
  const char: any = {
    id: "char_min_dmg",
    name: "Min Damage Tester",
    classId: "warrior",
    level: 1,
    maxHp: 10,
    hp: 10,
  };

  const ent: any = {
    id: "e_min_dmg",
    type: "player",
    maxHp: 10,
    hp: 10,
  };

  const hit = applySimpleDamageToPlayer(ent, 0.1, char, "physical");
  assert.equal(hit.newHp, 9);
  assert.equal(10 - hit.newHp, 1);
});

test("min-damage rule: zero and negative remain zero damage", () => {
  const char: any = { id: "char_zero", name: "Zero", classId: "warrior", level: 1, maxHp: 10, hp: 10 };
  const ent: any = { id: "e_zero", type: "player", maxHp: 10, hp: 10 };

  const hitZero = applySimpleDamageToPlayer(ent, 0, char, "physical");
  assert.equal(hitZero.newHp, 10);

  const hitNeg = applySimpleDamageToPlayer(ent, -5, char, "physical");
  assert.equal(hitNeg.newHp, 10);
});

test("min-damage rule plays nicely with incoming multipliers", () => {
  const char: any = {
    id: "char_min_dmg_mult",
    name: "Min Damage Mult Tester",
    classId: "warrior",
    level: 1,
    maxHp: 10,
    hp: 10,
  };

  const ent: any = {
    id: "e_min_dmg_mult",
    type: "player",
    maxHp: 10,
    hp: 10,
  };

  // +25% incoming (fractional)
  applyStatusEffect(char, {
    id: "test_taken_25",
    sourceKind: "environment",
    sourceId: "test_taken_25_src",
    name: "Test Incoming +25%",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    tags: ["debuff", "incoming_damage"],
    modifiers: {
      damageTakenPct: 0.25,
    },
  });

  const hit = applySimpleDamageToPlayer(ent, 0.1, char, "fire");
  // Still at least 1; 1 * 1.25 floors to 1.
  assert.equal(hit.newHp, 9);
});
