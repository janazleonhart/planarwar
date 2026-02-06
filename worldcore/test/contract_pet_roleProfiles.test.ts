// worldcore/test/contract_pet_roleProfiles.test.ts
//
// Contract: role profiles are distinct and deterministic.

import test from "node:test";
import assert from "node:assert/strict";

import { applyProfileToPetVitals, getProfileDamageMult } from "../pets/PetProfiles";

test("[contract] pet role profiles: tank vs dps are distinct", () => {
  const base: any = { hp: 100, maxHp: 100, petTags: [] };

  const tank: any = { ...base, petRole: "pet_tank" };
  applyProfileToPetVitals(tank);

  const dps: any = { ...base, petRole: "pet_dps" };
  applyProfileToPetVitals(dps);

  assert.ok(tank.maxHp > dps.maxHp, "tank should have higher maxHp");
  assert.ok(getProfileDamageMult(dps) > getProfileDamageMult(tank), "dps should have higher dmg mult");
});
