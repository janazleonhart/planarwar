// worldcore/test/doubleDipGuard.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";
import { applySimpleDamageToPlayer, applyCombatResultToPlayer } from "../combat/entityCombat";
import {
  applyStatusEffect,
  clearAllStatusEffects,
  computeCombatStatusSnapshot,
} from "../combat/StatusEffects";
import { withRandomSequence } from "./testUtils";

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

test("applyCombatResultToPlayer prevents double-dipping when CombatEngine already applied defender taken mods", () => {
  const attacker = makeChar("attacker");
  const defender = makeChar("defender");
  clearAllStatusEffects(defender);

  // Defender has +25% global taken and +50% fire taken => total +75%
  applyStatusEffect(defender, {
    id: "global_taken",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPct: 0.25 },
  });

  applyStatusEffect(defender, {
    id: "fire_taken",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPctBySchool: { fire: 0.5 } },
  });

  const source: any = { char: attacker, effective: {}, channel: "spell" };
  const target: any = {
    entity: makeEntity(1000),
    armor: 0,
    resist: {},
    defenderStatus: computeCombatStatusSnapshot(defender),
  };

  // roll=1.0, critRoll=0.99 (no crit)
  withRandomSequence([0.5, 0.99], () => {
    const r = computeDamage(source, target, {
      basePower: 100,
      damageSchool: "fire",
      applyDefenderDamageTakenMods: true,
    });

    // CombatEngine already applied taken mods => 175
    assert.equal(r.damage, 175);
    assert.equal(r.includesDefenderTakenMods, true);

    // SAFE APPLY: should NOT apply taken mods again.
    const entSafe = makeEntity(1000);
    applyCombatResultToPlayer(entSafe, r, defender);
    assert.equal(entSafe.hp, 825);

    // UNSAFE APPLY: demonstrates what double-dipping would look like if someone did it wrong.
    const entUnsafe = makeEntity(1000);
    applySimpleDamageToPlayer(entUnsafe, r.damage, defender, r.school);
    // 175 * 1.75 = 306.25 => 306
    assert.equal(entUnsafe.hp, 694);
  });
});
