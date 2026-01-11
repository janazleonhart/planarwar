import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffect, clearAllStatusEffects } from "../combat/StatusEffects";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { computeDamage } from "../combat/CombatEngine";

function makeChar(id: string): any {
  return {
    id,
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

function makeEntity(hp: number): any {
  return { id: "ent", hp, maxHp: hp, alive: true };
}

test("incoming damageTakenPctBySchool increases only that school (not physical)", () => {
  const targetChar = makeChar("target");
  clearAllStatusEffects(targetChar);

  applyStatusEffect(targetChar, {
    id: "oiled",
    sourceKind: "environment",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: {
      damageTakenPctBySchool: { fire: 0.5 },
    },
  });

  const fireTarget = makeEntity(1000);
  applySimpleDamageToPlayer(fireTarget, 100, targetChar, "fire");
  assert.equal(fireTarget.hp, 850);

  const physTarget = makeEntity(1000);
  applySimpleDamageToPlayer(physTarget, 100, targetChar, "physical");
  assert.equal(physTarget.hp, 900);
});

test("incoming damageTakenPctBySchool stacks additively with global damageTakenPct", () => {
  const targetChar = makeChar("target");
  clearAllStatusEffects(targetChar);

  applyStatusEffect(targetChar, {
    id: "global_vuln",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPct: 0.25 },
  });

  applyStatusEffect(targetChar, {
    id: "fire_vuln",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPctBySchool: { fire: 0.5 } },
  });

  const target = makeEntity(1000);
  applySimpleDamageToPlayer(target, 100, targetChar, "fire");
  // 100 * (1 + 0.25 + 0.5) = 175
  assert.equal(target.hp, 825);
});

test("ordering is floor-sensitive: mitigation first, then incoming per-school", () => {
  const rnd = Math.random;
  try {
    // deterministic roll => roll=1.0
    (Math as any).random = () => 0.5;

    const attackerChar = makeChar("attacker");
    const targetChar = makeChar("target");
    clearAllStatusEffects(attackerChar);
    clearAllStatusEffects(targetChar);

    // +25% incoming fire only
    applyStatusEffect(targetChar, {
      id: "fire_vuln",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 60_000,
      modifiers: { damageTakenPctBySchool: { fire: 0.25 } },
    });

    const source: any = {
      char: attackerChar,
      effective: {},
      channel: "spell",
    };

    const target: any = {
      entity: makeEntity(100),
      resist: { fire: 100 }, // 100 => resistMultiplier(100)=0.5 (expected by v1 tests)
    };

    // basePower=5 => after resists => floor(2.5)=2
    const roll = computeDamage(source, target, { basePower: 5, damageSchool: "fire" });

    applySimpleDamageToPlayer(target.entity, roll.damage, targetChar, roll.school);

    // Correct ordering: floor(2.5)=2, then *1.25 => 2.5 floored => 2
    assert.equal(target.entity.hp, 98);
  } finally {
    (Math as any).random = rnd;
  }
});
