// worldcore/skills/SkillProgression.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type { WeaponSkillId, SpellSchoolId } from "../combat/CombatEngine";

export type WeaponSkillMap = Partial<Record<WeaponSkillId, number>>;
export type SpellSchoolMap = Partial<Record<SpellSchoolId, number>>;

// v1 song “instrument” schools – expand later as needed
export type SongSchoolId = "voice" | "strings" | "winds";

export type SongSchoolMap = Partial<Record<SongSchoolId, number>>;

interface SkillRoot {
  weapons?: WeaponSkillMap;
  spells?: SpellSchoolMap;
  songs?: SongSchoolMap;
}

function ensureSkillRoot(char: CharacterState): SkillRoot {
  const prog: any = char.progression || {};

  if (!prog.skills) {
    prog.skills = {};
    char.progression = prog;
  }

  return prog.skills as SkillRoot;
}

function ensureWeaponSkills(char: CharacterState): WeaponSkillMap {
  const root = ensureSkillRoot(char);

  if (!root.weapons) {
    root.weapons = {};
  }

  return root.weapons;
}

function ensureSpellSchools(char: CharacterState): SpellSchoolMap {
  const root = ensureSkillRoot(char);

  if (!root.spells) {
    root.spells = {};
  }

  return root.spells;
}

function ensureSongSchools(char: CharacterState): SongSchoolMap {
  const root = ensureSkillRoot(char);

  if (!root.songs) {
    root.songs = {};
  }

  return root.songs;
}

// --- Weapon skills ---

export function getWeaponSkill(
  char: CharacterState,
  skill: WeaponSkillId
): number {
  const map = ensureWeaponSkills(char);
  const value = map[skill];

  if (typeof value !== "number" || value < 0) {
    return 0; // v1: missing skill = 0
  }

  return value;
}

export function gainWeaponSkill(
  char: CharacterState,
  skill: WeaponSkillId,
  amount: number
): void {
  if (amount <= 0) return;

  const map = ensureWeaponSkills(char);
  const current = getWeaponSkill(char, skill); // 0 if missing

  // v1 cap: level * 10
  const level =
    typeof char.level === "number" && char.level > 0 ? char.level : 1;
  const cap = level * 10;

  const next = Math.min(cap, current + amount);
  map[skill] = next;
}

// --- Spell school skills ---

export function getSpellSchoolSkill(
  char: CharacterState,
  school: SpellSchoolId
): number {
  const map = ensureSpellSchools(char);
  const value = map[school];

  if (typeof value !== "number" || value < 0) {
    return 0; // v1: missing skill = 0
  }

  return value;
}

export function gainSpellSchoolSkill(
  char: CharacterState,
  school: SpellSchoolId,
  amount: number
): void {
  if (amount <= 0) return;

  const map = ensureSpellSchools(char);
  const current = getSpellSchoolSkill(char, school); // 0 if missing

  const level =
    typeof char.level === "number" && char.level > 0 ? char.level : 1;
  const cap = level * 10;

  const next = Math.min(cap, current + amount);
  map[school] = next;
}

// --- Song “instrument” skills ---

export function getSongSchoolSkill(
  char: CharacterState,
  school: SongSchoolId
): number {
  const map = ensureSongSchools(char);
  const value = map[school];

  if (typeof value !== "number" || value < 0) {
    return 0;
  }

  return value;
}

export function gainSongSchoolSkill(
  char: CharacterState,
  school: SongSchoolId,
  amount: number
): void {
  if (amount <= 0) return;

  const map = ensureSongSchools(char);
  const current = getSongSchoolSkill(char, school);

  const level =
    typeof char.level === "number" && char.level > 0 ? char.level : 1;
  const cap = level * 10;

  const next = Math.min(cap, current + amount);
  map[school] = next;
}
