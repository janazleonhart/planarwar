// worldcore/test/contract_pet_profiles.test.ts
//
// Contract: pet profiles apply hp/damage multipliers deterministically.

import test from "node:test";
import assert from "node:assert/strict";
import { applyProfileToPetVitals, getProfileDamageMult } from "../pets/PetProfiles";

test("[contract] pet profiles: apply vitals + damage mult", () => {
  const pet: any = { hp: 40, maxHp: 40, petClass: "construct", petTags: [] };
  applyProfileToPetVitals(pet);
  assert.ok(pet.maxHp > 40, "construct should increase maxHp");
  assert.ok(pet.hp <= pet.maxHp, "hp clamped to maxHp");

  const dmg = getProfileDamageMult(pet);
  assert.ok(dmg > 0, "damage mult positive");

  const demon: any = { hp: 40, maxHp: 40, petClass: "demon", petTags: [] };
  applyProfileToPetVitals(demon);
  assert.ok(getProfileDamageMult(demon) > dmg * 0.9, "demon dmg mult should be >= construct-ish baseline");
});
