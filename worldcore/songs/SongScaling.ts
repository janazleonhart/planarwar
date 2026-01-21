// worldcore/songs/SongScaling.ts
//
// Central place for song scaling math so it doesn't drift across systems.
// v0 rule: factor = 1 + (songSkill / 100).
// v0.1: optional instrument bonus pct from gear/auras (applied multiplicatively).
// (Yes, it's simple. It's supposed to be. Complexity can be added later with tests.)

import type { CharacterState } from "../characters/CharacterTypes";
import { getSongSchoolSkill, type SongSchoolId } from "../skills/SkillProgression";

function clampBonusPct(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;

  // Safety rails: allow debuffs, but avoid negative/insane multipliers.
  // -90% minimum => never flips healing negative.
  // +500% maximum => still large, but prevents silly "1e9%" items.
  return Math.max(-0.9, Math.min(5, n));
}

export function computeSongScalarFromSkill(skill: number): number {
  const s = Number.isFinite(skill) ? Math.max(0, skill) : 0;
  return 1 + s / 100;
}

/**
 * Compute the total scaling factor for a song:
 *   skillFactor * (1 + instrumentBonusPct)
 *
 * NOTE: instrumentBonusPct is expected to be pre-aggregated (e.g., from gear).
 */
export function computeSongScalar(
  char: CharacterState,
  school: SongSchoolId,
  instrumentBonusPct?: number
): number {
  const skill = getSongSchoolSkill(char, school);
  const skillFactor = computeSongScalarFromSkill(skill);
  const bonusPct = clampBonusPct(instrumentBonusPct);
  return skillFactor * (1 + bonusPct);
}

export function scaleSongHealFloor(
  baseHeal: number,
  char: CharacterState,
  school: SongSchoolId,
  instrumentBonusPct?: number
): number {
  const base = Number.isFinite(baseHeal) ? baseHeal : 0;
  const factor = computeSongScalar(char, school, instrumentBonusPct);
  return Math.floor(base * factor);
}
