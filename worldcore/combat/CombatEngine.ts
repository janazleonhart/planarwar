// worldcore/combat/CombatEngine.ts

import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";
import type { AttackChannel } from "../actions/ActionTypes";
import { getWeaponSkillLevel, getSpellSchoolLevel } from "./CombatScaling";
import { Logger } from "../utils/logger";
import { getSongSchoolSkill, type SongSchoolId } from "../skills/SkillProgression";
import { computeCombatStatusSnapshot } from "./StatusEffects";
import type { CombatStatusSnapshot } from "./StatusEffects";
import { armorMultiplier } from "./Mitigation";
import { resistMultiplier } from "./Resists";

const log = Logger.scope("COMBAT");

// v1 enums: we keep these very small and expand later.
export type WeaponSkillId = "unarmed" | "one_handed" | "two_handed" | "ranged";

export type SpellSchoolId =
  | "arcane"
  | "fire"
  | "frost"
  | "shadow"
  | "holy"
  | "nature"
  | "song"; // used to flag bard songs as a special case

export type DamageSchool =
  | "physical"
  | "arcane"
  | "fire"
  | "frost"
  | "shadow"
  | "holy"
  | "nature"
  | "pure"; // “pure” = generally unresistable unless bosses say otherwise

export interface CombatSource {
  char: CharacterState;

  // v1: “effective” stats from computeEffectiveAttributes()
  // (already includes gear, titles, and attribute-modifying status effects)
  effective: Record<string, any>;

  channel: AttackChannel;

  // Optional extra flavor for scaling
  weaponSkill?: WeaponSkillId;
  spellSchool?: SpellSchoolId;

  // For songs: which instrument/vocal school to use for scaling
  songSchool?: SongSchoolId;

  // Later: talent modifiers, buffs, etc.
  tags?: string[];
}

export interface CombatTarget {
  entity: Entity;

  // Later: armor and resists can be derived from proto / equipment
  armor?: number;
  resist?: Partial<Record<DamageSchool, number>>;

  // Optional: precomputed status snapshot for the defender.
  // This lets mitigation respect armor/resist buffs/debuffs cleanly.
  defenderStatus?: CombatStatusSnapshot;
}

export interface CombatAttackParams {
  // Base swing/spell “power” before stats
  basePower?: number;

  // Scalar multipliers for abilities/spells
  // e.g. 1.5 = +50%
  damageMultiplier?: number;

  // e.g. +5 damage
  flatBonus?: number;

  damageSchool?: DamageSchool;
}

export interface CombatResult {
  damage: number;
  school: DamageSchool;
  wasCrit: boolean;
  wasGlancing: boolean;
}

function clampNonNegativeInt(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function applyArmorStatusMods(baseArmor: number, s?: CombatStatusSnapshot): number {
  if (!s) return clampNonNegativeInt(baseArmor);
  const flat = typeof s.armorFlat === "number" ? s.armorFlat : 0;
  const pct = typeof s.armorPct === "number" ? s.armorPct : 0;
  const afterFlat = baseArmor + flat;
  const afterPct = afterFlat * (1 + pct);
  return clampNonNegativeInt(afterPct);
}

function applyResistStatusMods(
  baseResist: number,
  school: DamageSchool,
  s?: CombatStatusSnapshot,
): number {
  if (!s) return clampNonNegativeInt(baseResist);
  const flat = (s.resistFlat as any)?.[school];
  const pct = (s.resistPct as any)?.[school];
  const flatN = typeof flat === "number" ? flat : 0;
  const pctN = typeof pct === "number" ? pct : 0;
  const afterFlat = baseResist + flatN;
  const afterPct = afterFlat * (1 + pctN);
  return clampNonNegativeInt(afterPct);
}

/**
 * v1 combat math:
 * - channel = "weapon" | "spell" | "ability"
 * - spells normally scale off INT + spell school
 * - songs scale off instrument (songSchool) instead of spell school
 * - status effects can add outgoing damage multipliers
 */
export function computeDamage(
  source: CombatSource,
  target: CombatTarget,
  params: CombatAttackParams = {},
): CombatResult {
  const school: DamageSchool =
    params.damageSchool ??
    (source.channel === "spell"
      ? source.spellSchool === "song"
        ? "pure"
        : ((source.spellSchool as DamageSchool) ?? "arcane")
      : "physical");

  const eff = source.effective || {};
  const str = eff.str ?? (source.char as any).attributes?.str ?? 10;
  const int = eff.int ?? (source.char as any).attributes?.int ?? 10;
  const level = source.char.level ?? 1;

  const weaponSkillLevel = getWeaponSkillLevel(source.char, source.weaponSkill);
  const spellSchoolLevel = getSpellSchoolLevel(source.char, source.spellSchool);

  // For normal spells, use spell school level.
  // For songs, prefer instrument skill from songSchool.
  let magicSkillLevel = spellSchoolLevel;
  if (source.songSchool) {
    try {
      magicSkillLevel = getSongSchoolSkill(source.char, source.songSchool);
    } catch {
      // If anything goes sideways, fall back to spell school level.
    }
  }

  // --- Base damage from stats/skills ---
  let base: number;
  switch (source.channel) {
    case "weapon": {
      // v1: STR + small level + weapon skill
      base =
        2 +
        Math.floor(str / 3) +
        Math.floor(level / 3) +
        Math.floor(weaponSkillLevel / 4);
      break;
    }
    case "ability": {
      // slightly better than a weapon swing, uses same weapon skill scaling
      base =
        3 +
        Math.floor(str / 2) +
        Math.floor(level / 2) +
        Math.floor(weaponSkillLevel / 3);
      break;
    }
    case "spell": {
      // spells & songs scale off INT + “magic” skill
      base =
        4 +
        Math.floor(int / 2) +
        Math.floor(level / 2) +
        Math.floor(magicSkillLevel / 3);
      break;
    }
    default:
      base = 3 + Math.floor(level / 2);
  }

  // Apply caller-provided basePower override if present
  if (typeof params.basePower === "number") {
    base = params.basePower;
  }

  // Tiny random roll, same feel as your current mob damage
  const roll = 0.8 + Math.random() * 0.4; // ±20%
  let dmg = base * roll;

  // Ability multipliers / flat bonus
  if (params.damageMultiplier && params.damageMultiplier !== 1) {
    dmg *= params.damageMultiplier;
  }
  if (params.flatBonus) {
    dmg += params.flatBonus;
  }

  // --- Status-based outgoing damage modifiers (buffs/debuffs on the attacker) ---
  let damageDealtPct = 0;
  try {
    const status = computeCombatStatusSnapshot(source.char);
    const global = status.damageDealtPct || 0;
    const bySchool =
      (status.damageDealtPctBySchool &&
        (status.damageDealtPctBySchool as any)[school]) || 0;

    // Additive stacking: global + per-school
    damageDealtPct = global + bySchool;
  } catch {
    // Status effect math must never break combat; ignore on error.
  }

  if (damageDealtPct) {
    dmg *= 1 + damageDealtPct;
  }

  // Very simple crit system v1 (later: proper crit chance per class/weapon)
  const critRoll = Math.random();
  let wasCrit = false;
  if (critRoll < 0.05) {
    dmg *= 1.5;
    wasCrit = true;
  }

  // Very simple glancing system for weapon swings, v1
  let wasGlancing = false;
  if (source.channel === "weapon" && Math.random() < 0.1) {
    dmg *= 0.7;
    wasGlancing = true;
  }

  // --- Mitigation (armor/resists) ---
  // Defender snapshot (optional) lets armor/resist buffs modify mitigation.
  const defenderStatus = target.defenderStatus;

  // Armor applies only to physical
  const armorBase = target.armor ?? 0;
  const armor = applyArmorStatusMods(armorBase, defenderStatus);
  if (school === "physical") {
    dmg *= armorMultiplier(armor);
  }

  // Resists apply to non-physical, non-pure schools
  if (school !== "physical" && school !== "pure") {
    const resistRatingBase = target.resist?.[school];
    const resistRating = applyResistStatusMods(
      typeof resistRatingBase === "number" ? resistRatingBase : 0,
      school,
      defenderStatus,
    );

    dmg *= resistMultiplier(resistRating);
  }

  // Clamp and floor
  if (!Number.isFinite(dmg) || dmg < 1) {
    dmg = 1;
  }
  const final = Math.floor(dmg);

  if (process.env.DEBUG_COMBAT === "1") {
    log.debug("computeDamage", {
      sourceClass: source.char.classId,
      level,
      channel: source.channel,
      school,
      base,
      roll,
      final,
      wasCrit,
      wasGlancing,
      damageDealtPct,
    });
  }

  return { damage: final, school, wasCrit, wasGlancing };
}
