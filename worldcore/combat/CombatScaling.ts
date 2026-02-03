// worldcore/combat/CombatScaling.ts

import { getWeaponSkill, getSpellSchoolSkill } from "../skills/SkillProgression";

import type { CharacterState } from "../characters/CharacterTypes";
import type { WeaponSkillId, SpellSchoolId } from "./CombatEngine";

/**
 * Weapon skill points cap (EQ-like): level * 5.
 * This mirrors how existing skill helpers convert points -> "level-like" via /5.
 */
export function getWeaponSkillCapPoints(char: CharacterState): number {
  const level =
    typeof char.level === "number" && char.level > 0 ? char.level : 1;
  return Math.max(5, level * 5);
}

/**
 * Raw weapon skill points (0 if missing / untrained).
 */
export function getWeaponSkillPoints(char: CharacterState, skill: WeaponSkillId): number {
  try {
    const raw = getWeaponSkill(char, skill);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

/**
 * "Familiarity" helper:
 * If a weapon skill is untrained (0 points), we still assume *some* baseline competence,
 * especially at low levels, so level 1 characters can swing anything and occasionally hit.
 *
 * At high levels, the familiarity floor is intentionally tiny relative to the cap,
 * so a level 50 character using a never-used weapon type will miss a lot until training up.
 */
export function getWeaponSkillPointsWithFamiliarity(
  char: CharacterState,
  skill: WeaponSkillId,
): number {
  const cap = getWeaponSkillCapPoints(char);
  const raw = getWeaponSkillPoints(char, skill);
  if (raw > 0) return Math.min(raw, cap);

  // Floor = min(15% of cap, 10 points)
  const floor = Math.min(Math.floor(cap * 0.15), 10);
  return Math.max(1, floor);
}

/**
 * v1: if you have no recorded skill, use character level.
 * If you do have skill points, use skill/5.
 *
 * NOTE:
 * We keep this behavior because many v1 damage formulas (computeDamage) assume
 * "no skill blob yet" should not nerf early characters.
 *
 * For accuracy/avoidance, use getWeaponSkillPointsWithFamiliarity() instead.
 */
export function getWeaponSkillLevel(
  char: CharacterState,
  skill: WeaponSkillId | undefined
): number {
  const baseLevel =
    typeof char.level === "number" && char.level > 0 ? char.level : 1;

  if (!skill) return baseLevel;

  const raw = getWeaponSkillPoints(char, skill); // 0 if missing
  if (raw <= 0) return baseLevel;

  return Math.max(1, Math.floor(raw / 5));
}

/**
 * Compute weapon-skill gain (points) for a single swing attempt.
 *
 * Design goals:
 * - Skill should increase when fighting non-trivial enemies.
 * - Trivial targets should not train skills.
 * - Training slows as you approach the cap.
 *
 * v1 policy:
 * - If defender is 10+ levels below attacker => 0 gain
 * - Otherwise gain 1 point per attempt while < 80% cap
 * - Near cap (>= 80%), require an actual hit to gain 1 point
 * - On hit vs near-level (defender >= attacker-2), add +1 bonus while below 60% cap
 */
export function computeWeaponSkillGainOnSwingAttempt(opts: {
  attackerLevel: number;
  defenderLevel: number;
  currentPoints: number;
  capPoints: number;
  didHit: boolean;
}): number {
  const attackerLevel = Number.isFinite(opts.attackerLevel) && opts.attackerLevel > 0 ? Math.floor(opts.attackerLevel) : 1;
  const defenderLevel = Number.isFinite(opts.defenderLevel) && opts.defenderLevel > 0 ? Math.floor(opts.defenderLevel) : 1;
  const cap = Number.isFinite(opts.capPoints) && opts.capPoints > 0 ? Math.floor(opts.capPoints) : attackerLevel * 5;
  const current = Math.max(0, Math.floor(opts.currentPoints || 0));

  if (current >= cap) return 0;

  // Too trivial => no training.
  if (defenderLevel <= attackerLevel - 10) return 0;

  const pct = cap > 0 ? current / cap : 0;

  // Near cap: only train on actual hits.
  if (pct >= 0.8) {
    return opts.didHit ? 1 : 0;
  }

  let gain = 1; // baseline attempt gain

  // Bonus for landing hits on near-level enemies while still learning.
  if (opts.didHit && defenderLevel >= attackerLevel - 2 && pct < 0.6) {
    gain += 1;
  }

  return gain;
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
