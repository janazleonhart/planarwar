// worldcore/test/contract_spellLearningRules.test.ts
//
// Contract: spell learning respects SpellUnlocks in db/test mode.
// - No rule => not learnable
// - Rule minLevel gate enforced
// - Successful learn marks spell known (via SpellTypes.isSpellKnownForChar)

import test from "node:test";
import assert from "node:assert/strict";

import { defaultSpellbook, defaultAbilities } from "../characters/CharacterTypes";
import { __setSpellUnlocksForTest, __resetSpellUnlocksForTest } from "../spells/SpellUnlocks";
import { learnSpellInState } from "../spells/SpellLearning";
import { isSpellKnownForChar } from "../spells/SpellTypes";

function mkMage(level: number): any {
  return {
    id: "c1",
    userId: "u1",
    name: "Mage",
    classId: "mage",
    level,
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
  };
}

test("[contract] learnSpell requires explicit rule in test mode and enforces minLevel", () => {
  __setSpellUnlocksForTest([
    { classId: "mage", spellId: "mage_fire_bolt", minLevel: 5, autoGrant: false, isEnabled: true, notes: "trainable" },
  ]);

  const c4 = mkMage(4);
  const r1 = learnSpellInState(c4 as any, "mage_fire_bolt", 1, 111);
  assert.equal(r1.ok, false);
  assert.equal((r1 as any).error, "level_too_low");

  // No rule => not learnable
  const rNo = learnSpellInState(c4 as any, "arcane_bolt", 1, 111);
  assert.equal(rNo.ok, false);
  assert.equal((rNo as any).error, "not_learnable");

  const c5 = mkMage(5);
  const r2 = learnSpellInState(c5 as any, "mage_fire_bolt", 1, 222);
  assert.equal(r2.ok, true);
  assert.equal(isSpellKnownForChar((r2 as any).next, "mage_fire_bolt"), true);

  __resetSpellUnlocksForTest();
});
