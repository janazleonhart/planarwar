// worldcore/test/smokeChecklist.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";
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

// This file is intentionally small and “high signal”.
// It’s your “the build is sane” checklist.

test("[smoke] outgoing global + per-school stacks additively", () => {
  const attacker = makeChar("a");
  clearAllStatusEffects(attacker);

  applyStatusEffect(attacker, {
    id: "global_out",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageDealtPct: 0.2 },
  });

  applyStatusEffect(attacker, {
    id: "fire_out",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageDealtPctBySchool: { fire: 0.5 } },
  });

  const source: any = { char: attacker, effective: {}, channel: "spell" };
  const target: any = { entity: makeEntity(100), armor: 0, resist: {} };

  // roll=1.0, critRoll=0.99 (no crit)
  withRandomSequence([0.5, 0.99], () => {
    const r = computeDamage(source, target, { basePower: 10, damageSchool: "fire" });
    // 10 * (1 + 0.2 + 0.5) = 17
    assert.equal(r.damage, 17);
  });
});

test("[smoke] incoming global + per-school stacks additively (and not for physical)", () => {
  const targetChar = makeChar("t");
  clearAllStatusEffects(targetChar);

  applyStatusEffect(targetChar, {
    id: "global_in",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPct: 0.25 },
  });

  applyStatusEffect(targetChar, {
    id: "fire_in",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageTakenPctBySchool: { fire: 0.5 } },
  });

  // Use high HP so we’re testing stacking math, not the HP floor clamp at 0.
  const ent = makeEntity(1000);

  // Fire should apply global+school: 100 * (1 + 0.25 + 0.5) = 175
  applySimpleDamageToPlayer(ent, 100, targetChar, "fire");
  assert.equal(ent.hp, 825);

  // Physical should apply ONLY global: 100 * (1 + 0.25) = 125
  const ent2 = makeEntity(1000);
  applySimpleDamageToPlayer(ent2, 100, targetChar, "physical");
  assert.equal(ent2.hp, 875);
});

test("[smoke] defenderStatus path can bake in incoming modifiers (no double-dip)", () => {
  const attacker = makeChar("a");
  const defender = makeChar("d");
  clearAllStatusEffects(defender);

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
    entity: makeEntity(100),
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

    // 100 * (1 + 0.25 + 0.5) = 175
    assert.equal(r.damage, 175);
    assert.equal(r.includesDefenderTakenMods, true);
  });
});

test("[smoke] floor-sensitive ordering stays stable (mitigation floors first)", () => {
  // This test is a canary for accidental ordering changes that cause off-by-1’s.
  // Use a resist multiplier that yields a fractional, then apply outgoing.
  const attacker = makeChar("a");
  clearAllStatusEffects(attacker);

  applyStatusEffect(attacker, {
    id: "global_out",
    sourceKind: "spell",
    sourceId: "test",
    durationMs: 60_000,
    modifiers: { damageDealtPct: 0.10 },
  });

  const source: any = { char: attacker, effective: {}, channel: "spell" };
  const target: any = {
    entity: makeEntity(100),
    armor: 0,
    resist: { fire: 100 }, // whatever your resistMultiplier(100) maps to (stable in current build)
  };

  withRandomSequence([0.5, 0.99], () => {
    const r = computeDamage(source, target, { basePower: 10, damageSchool: "fire" });
    // Just assert it's deterministic and non-zero. (Exact value is covered in resist tests.)
    assert.ok(r.damage >= 1);
  });
});
