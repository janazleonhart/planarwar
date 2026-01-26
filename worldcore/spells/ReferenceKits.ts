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
      spellId: "warlock_void_bolt",
      minLevel: 1,
      autoGrant: true,
      isEnabled: true,
      source: "reference_kit",
    },
    {
      kind: "spell",
      classId: "warlock",
      spellId: "warlock_fear",
      minLevel: 5,
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
