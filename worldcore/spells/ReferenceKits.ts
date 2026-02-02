// worldcore/spells/ReferenceKits.ts

// System 5.4: Reference Class Kits (L1–10)
//
// `ClassId` contains more classes than we seed here.
// This is a curated bootstrap kit set, so the map is intentionally Partial.
// Always use the helpers below so missing keys safely fall back to [].

import type { ClassId } from "../classes/ClassDefinitions";

export type ReferenceClassId = ClassId;

export type ReferenceKitEntry =
  | {
      kind: "spell";
      classId: ReferenceClassId;
      spellId: string;
      minLevel: number;
      autoGrant: boolean;
      isEnabled: boolean;
      source: "reference_kit";
    }
  | {
      kind: "ability";
      classId: ReferenceClassId;
      abilityId: string;
      minLevel: number;
      autoGrant: boolean;
      isEnabled: boolean;
      source: "reference_kit";
    };

/**
 * Reference kits are a curated “starter set” for certain classes.
 * They are primarily used for testing + early balance, and can be mirrored into DB seeds.
 */
export const REFERENCE_CLASS_KITS_L1_10 = {
  warlord: [
    {
      kind: "ability",
      classId: "warlord",
      abilityId: "warlord_brutal_slam",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "ability",
      classId: "warlord",
      abilityId: "warlord_sunder_blow",
      minLevel: 4,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "ability",
      classId: "warlord",
      abilityId: "warlord_bulwark_bash",
      minLevel: 7,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
  ],

  archmage: [
    {
      kind: "spell",
      classId: "archmage",
      spellId: "archmage_arcane_bolt",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "archmage",
      spellId: "archmage_expose_arcana",
      minLevel: 3,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "archmage",
      spellId: "archmage_mana_shield",
      minLevel: 5,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "archmage",
      spellId: "archmage_ignite",
      minLevel: 7,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "archmage",
      spellId: "archmage_purge_hex",
      minLevel: 9,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
  ],

  warlock: [
    {
      kind: "spell",
      classId: "warlock",
      spellId: "warlock_shadow_bolt",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "warlock",
      spellId: "warlock_siphon_life",
      minLevel: 3,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "warlock",
      spellId: "warlock_drain_soul",
      minLevel: 5,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "warlock",
      spellId: "warlock_unholy_brand",
      minLevel: 7,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "warlock",
      spellId: "warlock_demon_skin",
      minLevel: 9,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
  ],

  crusader: [
    {
      kind: "spell",
      classId: "crusader",
      spellId: "crusader_righteous_strike",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "crusader",
      spellId: "crusader_bleeding_wound",
      minLevel: 3,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "crusader",
      spellId: "crusader_minor_mend",
      minLevel: 5,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "crusader",
      spellId: "crusader_sun_guard",
      minLevel: 7,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "crusader",
      spellId: "crusader_judgment",
      minLevel: 9,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
  ],

  hunter: [
    {
      kind: "spell",
      classId: "hunter",
      spellId: "hunter_steady_shot",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "hunter",
      spellId: "hunter_serrated_arrow",
      minLevel: 3,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "hunter",
      spellId: "hunter_hunters_mark",
      minLevel: 5,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "hunter",
      spellId: "hunter_field_dressing",
      minLevel: 7,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "hunter",
      spellId: "hunter_aimed_shot",
      minLevel: 9,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
  ],

  illusionist: [
    {
      kind: "spell",
      classId: "illusionist",
      spellId: "illusionist_mind_spike",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "illusionist",
      spellId: "illusionist_snare",
      minLevel: 3,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "illusionist",
      spellId: "illusionist_mesmerize",
      minLevel: 5,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "illusionist",
      spellId: "illusionist_mirror_image",
      minLevel: 7,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "illusionist",
      spellId: "illusionist_phantasmal_burn",
      minLevel: 9,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
  ],
  ascetic: [
    {
      kind: "spell",
      classId: "ascetic",
      spellId: "ascetic_jab",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "ascetic",
      spellId: "ascetic_tiger_palm",
      minLevel: 3,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "ascetic",
      spellId: "ascetic_crippling_strike",
      minLevel: 5,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "ascetic",
      spellId: "ascetic_flying_kick",
      minLevel: 7,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "ascetic",
      spellId: "ascetic_inner_focus",
      minLevel: 9,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
  ],


  templar: [
    {
      kind: "spell",
      classId: "templar",
      spellId: "templar_restorative_prayer",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "templar",
      spellId: "templar_smite",
      minLevel: 3,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "templar",
      spellId: "templar_minor_cleanse",
      minLevel: 5,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "templar",
      spellId: "templar_aegis_of_light",
      minLevel: 7,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "templar",
      spellId: "templar_judgment",
      minLevel: 9,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
  ],
} as const satisfies Partial<Record<ClassId, ReferenceKitEntry[]>>;

export function getReferenceKitEntriesForClass(classId: ClassId): ReferenceKitEntry[] {
  return (REFERENCE_CLASS_KITS_L1_10 as Partial<Record<ClassId, ReferenceKitEntry[]>>)[classId] ?? [];
}

export function getAllReferenceKitEntries(): ReferenceKitEntry[] {
  const out: ReferenceKitEntry[] = [];
  for (const list of Object.values(REFERENCE_CLASS_KITS_L1_10)) {
    if (Array.isArray(list)) out.push(...list);
  }
  return out;
}
