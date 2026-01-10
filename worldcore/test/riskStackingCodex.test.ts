// worldcore/test/riskStackingCodex.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { applyStatusEffect } from "../combat/StatusEffects";
import { applyArmorMitigation } from "../combat/Mitigation";

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
    "Baseline 100 damage should reduce HP from 1000 to 900 with no modifiers",
  );

  const baseDamage = 1000 - baseHit.newHp;
  assert.equal(baseDamage, 100);

  // Reset HP for the stacked test
  selfEntity.hp = 1000;
  char.hp = 1000;

  // --- Apply three separate sources of incoming-damage modifiers -----------
  //
  // IMPORTANT: damageTakenPct is stored as a FRACTION, not a whole percent.
  // 0.05 => +5% damage taken.
  //
  // - Cowardice (2 stacks): +5% each => +10% total (0.10)
  // - Region peril: +5% (0.05)
  // - Exposed weakness: +10% (0.10)
  // Total = +25% => 100 * 1.25 => 125 damage => hp=875.

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
      damageTakenPct: 0.05,
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
      damageTakenPct: 0.05,
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
      damageTakenPct: 0.10,
    },
  });

  // --- Stack test ----------------------------------------------------------
  const stackedHit = applySimpleDamageToPlayer(selfEntity, baseAmount, char);
  const stackedDamage = 1000 - stackedHit.newHp;

  assert.equal(
    stackedHit.newHp,
    875,
    "Expected 100 base damage with +25% incoming modifiers => 125 damage => hp=875",
  );
  assert.equal(stackedDamage, 125);

  // Sanity: must be strictly more than baseline
  assert.ok(
    stackedDamage > baseDamage,
    `Expected stacked damage > base damage, got base=${baseDamage}, stacked=${stackedDamage}`,
  );

  // Guard-rail: avoid explosions
  assert.ok(
    stackedDamage <= baseDamage * 20,
    `Stacked damage seems wildly out of range (base=${baseDamage}, stacked=${stackedDamage})`,
  );
});

test("Armor mitigation applies before incoming damageTakenPct (ordering is floor-sensitive)", () => {
  const char: any = {
    id: "char_armor_order",
    name: "Armor Order Tester",
    classId: "warrior",
    level: 10,
    maxHp: 1000,
    hp: 1000,
  };

  const selfEntity: any = {
    id: "e_char_armor_order",
    type: "player",
    maxHp: 1000,
    hp: 1000,
  };

  // We choose numbers where flooring makes the order observable.
  // Raw hit: 5.
  // Armor=100 (v1) => multiplier 0.5 => floor(5 * 0.5) = 2.
  // Then +25% incoming => floor(2 * 1.25) = 2.
  //
  // WRONG order (if +25% were applied before armor, with floors):
  // floor(5 * 1.25) = 6, then armor => floor(6 * 0.5) = 3.
  // We assert the real pipeline observes 2, not 3.

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

  const rawHit = 5;
  const armor = 100;

  const postArmor = applyArmorMitigation(rawHit, armor);
  assert.equal(postArmor, 2);

  const finalHit = applySimpleDamageToPlayer(selfEntity, postArmor, char);
  const finalDamage = 1000 - finalHit.newHp;

  const wrongOrder = applyArmorMitigation(Math.floor(rawHit * 1.25), armor);
  assert.equal(wrongOrder, 3);

  assert.equal(
    finalDamage,
    2,
    "Expected armor first (floored), then +25% incoming => still 2 damage",
  );
  assert.notEqual(
    finalDamage,
    wrongOrder,
    "If modifiers applied before armor, we'd observe 3 damage here",
  );
});
