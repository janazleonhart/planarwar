// worldcore/spells/SpellTypes.ts

import type { SpellSchoolId } from "../combat/CombatEngine";
import type { PowerResourceKind } from "../mud/MudResources";
import type { SongSchoolId } from "../skills/SkillProgression";

export type SpellKind = "damage_single_npc" | "heal_self";

export interface SpellDefinition {
  id: string;
  name: string;
  description: string;

  // "mage", "cleric", "virtuoso", "any", etc.
  classId: string;

  minLevel: number;
  kind: SpellKind;

  // Elemental school (for damage type / flavor / resists)
  school?: SpellSchoolId;

  // Resource usage
  resourceType?: PowerResourceKind; // usually "mana"
  resourceCost?: number;

  // For damage spells
  damageMultiplier?: number;
  flatBonus?: number;

  // For heals
  healAmount?: number;

  // Simple cooldown in ms
  cooldownMs?: number;

  // --- Song-specific metadata ---

  /**
   * True if this spell is a “song” and should scale from instrument skills
   * instead of traditional spell schools.
   */
  isSong?: boolean;

  /**
   * Instrument / vocal school this song uses for power scaling.
   * e.g. "voice", "strings", "winds", "Percussion", "Brass"
   */
  songSchool?: SongSchoolId;
}

export const SPELLS: Record<string, SpellDefinition> = {
  debug_arcane_bolt: {
    id: "debug_arcane_bolt",
    name: "Arcane Bolt",
    description:
      "A simple debug spell that blasts a single target with arcane energy.",
    classId: "any",
    minLevel: 1,
    kind: "damage_single_npc",
    school: "arcane",
    resourceType: "mana",
    resourceCost: 0, // free debug nuke for testing
    damageMultiplier: 1.4,
    flatBonus: 2,
    cooldownMs: 3000,
  },

  mage_fire_bolt: {
    id: "mage_fire_bolt",
    name: "Fire Bolt",
    description: "A basic fire spell that scorches a single enemy.",
    classId: "mage",
    minLevel: 1,
    kind: "damage_single_npc",
    school: "fire",
    resourceType: "mana",
    resourceCost: 15,
    damageMultiplier: 1.6,
    flatBonus: 3,
    cooldownMs: 2500,
  },

  cleric_minor_heal: {
    id: "cleric_minor_heal",
    name: "Minor Heal",
    description: "A small healing prayer that restores your health.",
    classId: "cleric",
    minLevel: 1,
    kind: "heal_self",
    resourceType: "mana",
    resourceCost: 10,
    healAmount: 20,
    cooldownMs: 5000,
  },

  // ---------------------------
  // Virtuoso v0.1 song kit
  // ---------------------------

  virtuoso_song_rising_courage: {
    id: "virtuoso_song_rising_courage",
    name: "Song of Rising Courage",
    description:
      "A rousing battle hymn that bolsters your spirit and mends minor wounds.",
    classId: "virtuoso",
    minLevel: 1,

    kind: "heal_self",
    school: "holy",
    resourceType: "mana",
    resourceCost: 8,
    healAmount: 12,
    cooldownMs: 6000,

    isSong: true,
    songSchool: "voice",
  },

  virtuoso_hymn_woven_recovery: {
    id: "virtuoso_hymn_woven_recovery",
    name: "Hymn of Woven Recovery",
    description: "A soothing hymn that knits flesh and spirit back together.",
    classId: "virtuoso",
    minLevel: 3,

    kind: "heal_self",
    school: "holy",
    resourceType: "mana",
    resourceCost: 18,
    healAmount: 35,
    cooldownMs: 12000,

    isSong: true,
    songSchool: "voice",
  },

  virtuoso_dissonant_battle_chant: {
    id: "virtuoso_dissonant_battle_chant",
    name: "Dissonant Battle Chant",
    description:
      "A jagged, clashing war-chant that tears at an enemy’s resolve.",
    classId: "virtuoso",
    minLevel: 5,

    kind: "damage_single_npc",
    school: "shadow",
    resourceType: "mana",
    resourceCost: 12,
    damageMultiplier: 1.2,
    flatBonus: 4,
    cooldownMs: 8000,

    isSong: true,
    songSchool: "voice",
  },
};

export function findSpellByNameOrId(input: string): SpellDefinition | null {
  const needle = input.trim().toLowerCase();
  if (!needle) return null;

  // id first
  if (SPELLS[needle]) return SPELLS[needle];

  // then by exact name
  const match = Object.values(SPELLS).find(
    (s) => s.name.toLowerCase() === needle
  );

  return match ?? null;
}
