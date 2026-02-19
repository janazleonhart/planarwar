// worldcore/test/contract_absorbOrdering_noDoubleDipCombatEngine.test.ts
//
// Contract:
// - CombatEngine defender taken-mods should NOT double-dip in the player damage pipeline.
// - Shields must still absorb the FINAL (already-modified) damage amount.
//
// Safe path under test:
//   computeDamage(... applyDefenderDamageTakenMods: true) -> result.includesDefenderTakenMods=true
//   applyCombatResultToPlayer(...): sets incomingModsAlreadyApplied=true automatically
//   absorb still applies to result.damage

import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";
import { applyCombatResultToPlayer } from "../combat/entityCombat";
import {
  applyStatusEffect,
  clearAllStatusEffects,
  computeCombatStatusSnapshot,
  getActiveStatusEffects,
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

test("[contract] absorb ordering: CombatEngine defender taken mods do not double-dip; shields absorb final", () => {
  const realNow = Date.now;
  Date.now = () => 9_000_000;
  try {
    const attacker = makeChar("attacker");
    const defender = makeChar("defender");
    clearAllStatusEffects(defender);

    // Defender has +100% taken (double damage)
    applyStatusEffect(defender, {
      id: "taken_double",
      sourceKind: "spell",
      sourceId: "test_taken",
      durationMs: 60_000,
      modifiers: { damageTakenPct: 1.0 },
    });

    // Defender also has a 10-point absorb shield.
    applyStatusEffect(defender, {
      id: "absorb10",
      sourceKind: "spell",
      sourceId: "test_shield",
      name: "Test Shield",
      durationMs: 60_000,
      tags: ["shield"],
      modifiers: {},
      absorb: { amount: 10 },
    });

    const source: any = { char: attacker, effective: {}, channel: "spell" };
    const target: any = {
      entity: makeEntity(1000),
      armor: 0,
      resist: {},
      defenderStatus: computeCombatStatusSnapshot(defender),
    };

    // deterministic: no crit
    withRandomSequence([0.5, 0.99], () => {
      const r = computeDamage(source, target, {
        basePower: 6,
        damageSchool: "physical",
        applyDefenderDamageTakenMods: true,
      });

      // basePower 6 doubled by taken mods => 12
      assert.equal(r.damage, 12);
      assert.equal(r.includesDefenderTakenMods, true);

      const ent = makeEntity(1000);
      const applied = applyCombatResultToPlayer(ent, r, defender);

      // Shield should absorb 10 of the *final* 12.
      assert.equal(applied.absorbed, 10);
      assert.equal(ent.hp, 998);

      // Shield instance should be removed when depleted (10 consumed).
      const active = getActiveStatusEffects(defender);
      const stillHasShield = active.some((se: any) => se.sourceId === "test_shield");
      assert.equal(stillHasShield, false);
    });
  } finally {
    Date.now = realNow;
  }
});
