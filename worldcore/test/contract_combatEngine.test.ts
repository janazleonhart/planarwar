import test from "node:test";
import assert from "node:assert/strict";

import {
  computeDamage,
  type CombatAttackParams,
  type CombatResult,
  type DamageSchool,
  type SpellSchoolId,
  type WeaponSkillId,
} from "../combat/CombatEngine";

type Assert<T extends true> = T;

type HasIncludesDefenderTakenMods = CombatResult extends {
  includesDefenderTakenMods?: boolean;
}
  ? true
  : false;

const _hasFlag: Assert<HasIncludesDefenderTakenMods> = true;

test("[contract] CombatEngine exports and shapes are stable", () => {
  assert.equal(typeof computeDamage, "function");

  const _weapon: WeaponSkillId = "unarmed";
  const _spell: SpellSchoolId = "arcane";
  const _school: DamageSchool = "physical";

  const _params: CombatAttackParams = {
    basePower: 1,
    damageMultiplier: 1,
    flatBonus: 0,
    damageSchool: _school,
    applyDefenderDamageTakenMods: false,
  };

  assert.ok(_weapon && _spell && _params);
});
