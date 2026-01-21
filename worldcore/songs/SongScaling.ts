// worldcore/songs/SongScaling.ts
//
// Central place for song scaling math so it doesn't drift across systems.
// v0 rule: factor = 1 + (songSkill / 100).
// (Yes, it's simple. It's supposed to be. Complexity can be added later with tests.)

import type { CharacterState } from "../characters/CharacterTypes";
import { getSongSchoolSkill, type SongSchoolId } from "../skills/SkillProgression";

export function computeSongScalarFromSkill(skill: number): number {
  const s = Number.isFinite(skill) ? Math.max(0, skill) : 0;
  return 1 + s / 100;
}

export function computeSongScalar(char: CharacterState, school: SongSchoolId): number {
  const skill = getSongSchoolSkill(char, school);
  return computeSongScalarFromSkill(skill);
}

export function scaleSongHealFloor(baseHeal: number, char: CharacterState, school: SongSchoolId): number {
  const base = Number.isFinite(baseHeal) ? baseHeal : 0;
  const factor = computeSongScalar(char, school);
  return Math.floor(base * factor);
}
