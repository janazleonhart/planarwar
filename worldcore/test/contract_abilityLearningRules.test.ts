// worldcore/test/contract_abilityLearningRules.test.ts
//
// Contract: ability learning respects AbilityUnlocks in db/test mode.
// - Auto-grant disabled => ability is not known until learned
// - Successful learn marks ability known
//
// NOTE: Do not hardcode ability ids. Select a real ability from ABILITIES.

import test from "node:test";
import assert from "node:assert/strict";

import { defaultSpellbook, defaultAbilities } from "../characters/CharacterTypes";
import { ABILITIES } from "../abilities/AbilityTypes";
import { __setAbilityUnlocksForTest, __resetAbilityUnlocksForTest } from "../abilities/AbilityUnlocks";
import { isAbilityKnownForChar, listKnownAbilitiesForChar, learnAbilityInState } from "../abilities/AbilityLearning";

function mkWarrior(level: number): any {
  return {
    id: "c1",
    userId: "u1",
    name: "Warrior",
    classId: "warrior",
    level,
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
  };
}

function pickWarriorAbilityId(): string {
  const ability = Object.values(ABILITIES).find(
    (a: any) =>
      String(a?.classId ?? "").toLowerCase() === "warrior" &&
      a?.kind === "melee_single" &&
      (a?.minLevel ?? 1) <= 1,
  ) as any;

  assert.ok(
    ability && ability.id,
    "Expected at least one warrior melee_single ability with minLevel<=1 in ABILITIES.",
  );
  return String(ability.id);
}

test("[contract] ability unlock rules gate known vs learnable in test mode", () => {
  const abilityId = pickWarriorAbilityId();

  __setAbilityUnlocksForTest([
    { classId: "warrior", abilityId, minLevel: 1, autoGrant: false, isEnabled: true, notes: "trainable" },
  ]);

  const c1 = mkWarrior(1);
  assert.equal(isAbilityKnownForChar(c1 as any, abilityId), false);

  const knownBefore = listKnownAbilitiesForChar(c1 as any);
  assert.equal(knownBefore.length, 0);

  const learned = learnAbilityInState(c1 as any, abilityId, 1, 333);
  assert.equal(learned.ok, true);
  assert.equal(isAbilityKnownForChar((learned as any).next, abilityId), true);

  const knownAfter = listKnownAbilitiesForChar((learned as any).next);
  assert.equal(knownAfter.some((a: any) => a.id === abilityId), true);

  __resetAbilityUnlocksForTest();
});
