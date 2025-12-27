// worldcore/combat/CombatScaling.ts

import { getWeaponSkill, getSpellSchoolSkill } from "../skills/SkillProgression";

import type { CharacterState } from "../characters/CharacterTypes";
import type { WeaponSkillId, SpellSchoolId } from "./CombatEngine";

/**
 * v1: if you have no recorded skill, use character level.
 * If you do have skill points, use skill/5.
 */
 export function getWeaponSkillLevel(
  char: CharacterState,
  skill: WeaponSkillId | undefined
): number {
  const baseLevel =
    typeof char.level === "number" && char.level > 0 ? char.level : 1;

  if (!skill) return baseLevel;

  const raw = getWeaponSkill(char, skill); // 0 if missing
  if (raw <= 0) return baseLevel;

  return Math.max(1, Math.floor(raw / 5));
}

/**
 * Same logic for spells: no training → use level,
 * trained → use skill/5.
 */
export function getSpellSchoolLevel(
  char: CharacterState,
  school: SpellSchoolId | undefined
): number {
  const baseLevel =
    typeof char.level === "number" && char.level > 0 ? char.level : 1;

  if (!school) return baseLevel;

  const raw = getSpellSchoolSkill(char, school);
  if (raw <= 0) return baseLevel;

  return Math.max(1, Math.floor(raw / 5));
}