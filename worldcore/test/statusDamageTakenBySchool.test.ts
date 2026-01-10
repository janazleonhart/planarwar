// worldcore/test/statusDamageTakenBySchool.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { applyStatusEffect } from "../combat/StatusEffects";

test("status damageTakenPctBySchool affects only matching school when provided", () => {
  const char: any = {
    id: "char_taken_school",
    name: "Taken School Tester",
    classId: "warrior",
    level: 1,
    progression: {},
  };

  const selfEntity: any = {
    id: "e_taken_school",
    type: "player",
    maxHp: 1000,
    hp: 1000,
  };

  // +25% fire damage taken
  applyStatusEffect(char, {
    id: "debuff_fire_vuln",
    sourceKind: "environment",
    sourceId: "test",
    name: "Fire Vulnerability",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    modifiers: { damageTakenPctBySchool: { fire: 0.25 } },
  });

  // Fire hit gets increased
  let r = applySimpleDamageToPlayer(selfEntity, 100, char, "fire");
  assert.equal(r.newHp, 875);

  // Reset
  selfEntity.hp = 1000;

  // Physical hit unchanged (no school modifier applied)
  r = applySimpleDamageToPlayer(selfEntity, 100, char, "physical");
  assert.equal(r.newHp, 900);
});

test("status damageTakenPct stacks additively with damageTakenPctBySchool", () => {
  const char: any = {
    id: "char_taken_add",
    name: "Taken Add Tester",
    classId: "warrior",
    level: 1,
    progression: {},
  };

  const selfEntity: any = {
    id: "e_taken_add",
    type: "player",
    maxHp: 1000,
    hp: 1000,
  };

  // Global +10% and fire-only +25% => total +35%
  applyStatusEffect(char, {
    id: "debuff_global",
    sourceKind: "environment",
    sourceId: "test",
    name: "Global Incoming",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    modifiers: { damageTakenPct: 0.10 },
  });

  applyStatusEffect(char, {
    id: "debuff_fire",
    sourceKind: "environment",
    sourceId: "test",
    name: "Fire Vulnerability",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    modifiers: { damageTakenPctBySchool: { fire: 0.25 } },
  });

  const r = applySimpleDamageToPlayer(selfEntity, 100, char, "fire");
  assert.equal(r.newHp, 865, "Expected 100 * 1.35 => 135 damage => hp=865");
});
