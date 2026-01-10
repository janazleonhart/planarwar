// worldcore/test/statusDamageDealtBySchool.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";
import { applyStatusEffect } from "../combat/StatusEffects";

function withFixedRandom<T>(value: number, fn: () => T): T {
  const prev = Math.random;
  (Math as any).random = () => value;
  try {
    return fn();
  } finally {
    (Math as any).random = prev;
  }
}

test("status damageDealtPctBySchool affects only matching school", () => {
  const char: any = {
    id: "char_dealt_school",
    name: "Dealt School Tester",
    classId: "mage",
    level: 1,
    progression: {},
  };

  const target: any = { id: "t", type: "npc", maxHp: 1000, hp: 1000, armor: 0, resist: {} };

  const sourceFire: any = {
    char,
    channel: "spell",
    spellSchool: "fire",
    effective: { int: 10 },
  };

  const sourceFrost: any = {
    char,
    channel: "spell",
    spellSchool: "frost",
    effective: { int: 10 },
  };

  applyStatusEffect(char, {
    id: "buff_fire_power",
    sourceKind: "spell",
    sourceId: "test",
    name: "Fire Power",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    modifiers: { damageDealtPctBySchool: { fire: 0.2 } }, // +20% fire only
  });

  withFixedRandom(0.5, () => {
    const fire = computeDamage(sourceFire, { entity: target, armor: 0, resist: {} }, { basePower: 10 });
    const frost = computeDamage(sourceFrost, { entity: target, armor: 0, resist: {} }, { basePower: 10 });

    assert.equal(fire.damage, 12, "Fire spell should be buffed by +20%");
    assert.equal(frost.damage, 10, "Frost spell should not be buffed by fire-only modifier");
  });
});

test("status damageDealtPct and damageDealtPctBySchool stack additively", () => {
  const char: any = {
    id: "char_dealt_add",
    name: "Dealt Add Tester",
    classId: "mage",
    level: 1,
    progression: {},
  };

  const target: any = { id: "t", type: "npc", maxHp: 1000, hp: 1000, armor: 0, resist: {} };

  const sourceFire: any = {
    char,
    channel: "spell",
    spellSchool: "fire",
    effective: { int: 10 },
  };

  // Global +10% and fire-only +20% => total +30%
  applyStatusEffect(char, {
    id: "buff_global",
    sourceKind: "spell",
    sourceId: "test",
    name: "Global Power",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    modifiers: { damageDealtPct: 0.1 },
  });

  applyStatusEffect(char, {
    id: "buff_fire",
    sourceKind: "spell",
    sourceId: "test",
    name: "Fire Power",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    modifiers: { damageDealtPctBySchool: { fire: 0.2 } },
  });

  withFixedRandom(0.5, () => {
    const fire = computeDamage(sourceFire, { entity: target, armor: 0, resist: {} }, { basePower: 10 });
    assert.equal(fire.damage, 13, "Expected +30% total => 13 damage from 10 with deterministic roll");
  });
});
