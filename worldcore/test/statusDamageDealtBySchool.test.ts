// worldcore/test/statusDamageDealtBySchool.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";
import { applyStatusEffect, clearAllStatusEffects } from "../combat/StatusEffects";

function withDeterministicRandom<T>(fn: () => T): T {
  const old = Math.random;
  (Math as any).random = () => 0.5; // roll=1.0, critRoll=0.5 (no crit), deterministic
  try {
    return fn();
  } finally {
    (Math as any).random = old;
  }
}

function mkChar(): any {
  return {
    id: "char_outgoing_school",
    name: "Outgoing School Tester",
    classId: "mage",
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

function mkTarget(): any {
  return {
    entity: { id: "npc_target", name: "Target", type: "npc" },
    armor: 0,
    resist: {},
  };
}

test("damageDealtPctBySchool applies only to matching outgoing school", () => {
  const char = mkChar();
  const target = mkTarget();

  withDeterministicRandom(() => {
    clearAllStatusEffects(char);

    // Baseline: 20
    const baseFire = computeDamage(
      {
        char,
        effective: { str: 10, int: 10 },
        channel: "spell",
        spellSchool: "fire",
      },
      target,
      { basePower: 20 },
    );
    assert.equal(baseFire.damage, 20);

    applyStatusEffect(char, {
      id: "test_dealt_fire_25",
      sourceKind: "environment",
      sourceId: "test",
      name: "Fire Dealt +25%",
      durationMs: 60_000,
      maxStacks: 1,
      initialStacks: 1,
      tags: ["buff"],
      modifiers: {
        damageDealtPctBySchool: { fire: 0.25 },
      },
    });

    // Fire should be amplified: 20 * 1.25 = 25
    const buffedFire = computeDamage(
      {
        char,
        effective: { str: 10, int: 10 },
        channel: "spell",
        spellSchool: "fire",
      },
      target,
      { basePower: 20 },
    );
    assert.equal(buffedFire.damage, 25);

    // Physical should NOT be amplified by fire-only outgoing modifier.
    const physical = computeDamage(
      {
        char,
        effective: { str: 10, int: 10 },
        channel: "spell",
        spellSchool: "fire",
      },
      target,
      { basePower: 20, damageSchool: "physical" },
    );
    assert.equal(physical.damage, 20);
  });
});

test("global + per-school outgoing modifiers stack additively", () => {
  const char = mkChar();
  const target = mkTarget();

  withDeterministicRandom(() => {
    clearAllStatusEffects(char);

    applyStatusEffect(char, {
      id: "test_dealt_global_10",
      sourceKind: "environment",
      sourceId: "test",
      name: "Dealt +10%",
      durationMs: 60_000,
      maxStacks: 1,
      initialStacks: 1,
      tags: ["buff"],
      modifiers: { damageDealtPct: 0.10 },
    });

    applyStatusEffect(char, {
      id: "test_dealt_fire_15",
      sourceKind: "environment",
      sourceId: "test",
      name: "Fire Dealt +15%",
      durationMs: 60_000,
      maxStacks: 1,
      initialStacks: 1,
      tags: ["buff"],
      modifiers: { damageDealtPctBySchool: { fire: 0.15 } },
    });

    // total = +25% => 20 * 1.25 = 25
    const dmg = computeDamage(
      {
        char,
        effective: { str: 10, int: 10 },
        channel: "spell",
        spellSchool: "fire",
      },
      target,
      { basePower: 20 },
    );

    assert.equal(dmg.damage, 25);
  });
});
