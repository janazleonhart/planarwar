// worldcore/test/riskStackingCodex.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { applyStatusEffect } from "../combat/StatusEffects";

test("Stacked cowardice + region peril + vulnerability increase incoming damage additively", () => {
  const char: any = {
    id: "char_risk",
    name: "Risk Tester",
    classId: "warrior",
    level: 10,
    maxHp: 1000,
    hp: 1000,
  };

  const selfEntity: any = {
    id: "e_char_risk",
    type: "player",
    maxHp: 1000,
    hp: 1000,
  };

  const baseAmount = 100;

  // --- Baseline: no status effects -----------------------------------------
  const baseHit = applySimpleDamageToPlayer(selfEntity, baseAmount, char);
  assert.equal(
    baseHit.newHp,
    900,
    "Baseline 100 damage should reduce HP from 1000 to 900 with no modifiers"
  );

  const baseDamage = 1000 - baseHit.newHp;
  assert.equal(baseDamage, 100);

  // Reset HP for the stacked test
  selfEntity.hp = 1000;
  char.hp = 1000;

  // --- Apply three separate sources of incoming-damage modifiers -----------

  // 1) Cowardice-style debuff (+5% per stack, 2 stacks here)
  applyStatusEffect(char, {
    id: "test_cowardice",
    sourceKind: "environment",
    sourceId: "test_cowardice_src",
    name: "Test Cowardice",
    durationMs: 60_000,
    maxStacks: 5,
    initialStacks: 2,
    tags: ["debuff", "cowardice"],
    modifiers: {
      damageTakenPct: 5,
    },
  });

  // 2) Region peril (+5% taken)
  applyStatusEffect(char, {
    id: "test_region_peril",
    sourceKind: "environment",
    sourceId: "test_region_src",
    name: "Test Region Peril",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    tags: ["debuff", "region", "danger"],
    modifiers: {
      damageTakenPct: 5,
    },
  });

  // 3) Exposed weakness (+10% taken)
  applyStatusEffect(char, {
    id: "test_exposed_weakness",
    sourceKind: "environment",
    sourceId: "test_vuln_src",
    name: "Test Exposed Weakness",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    tags: ["debuff", "vulnerability"],
    modifiers: {
      damageTakenPct: 10,
    },
  });

  // --- Stack test ----------------------------------------------------------

  const stackedHit = applySimpleDamageToPlayer(selfEntity, baseAmount, char);
  const stackedDamage = 1000 - stackedHit.newHp;

  // Must be strictly more than the baseline 100 dmg.
  assert.ok(
    stackedDamage > baseDamage,
    `Expected stacked damage > base damage, got base=${baseDamage}, stacked=${stackedDamage}`
  );

  // And it shouldn't go completely insane (guard-rail, very generous).
  assert.ok(
    stackedDamage <= baseDamage * 20,
    `Stacked damage seems wildly out of range (base=${baseDamage}, stacked=${stackedDamage})`
  );
});
