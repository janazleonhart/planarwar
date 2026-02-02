// worldcore/classes/ClassDefinitions.ts

import type { Attributes } from "../characters/CharacterTypes";

export type CombatRole = "tank" | "healer" | "dps";

export type ClassId =
  | "virtuoso"
  | "illusionist"
  | "ascetic"
  | "prophet"
  | "crusader"
  | "revenant"
  | "hierophant"
  | "warlord"
  | "templar"
  | "defiler"
  | "conjuror"
  | "archmage"
  | "cutthroat"
  | "ravager"
  | "primalist"
  | "outrider"
  | "adventurer"
  | "warlock"
  | "hunter"
  | "runic_knight"
  // temporary/debug aliases
  | "warrior"
  | "mage"
  | "rogue"
  | "priest"
  | "default";

export type ClassArchetype =
  | "tank"
  | "melee_dps"
  | "ranged_dps"
  | "healer"
  | "support"
  | "hybrid";

export type PrimaryResourceId = "mana" | "fury" | "none";

// Simple power-resource metadata for future use
export interface PowerResourceSpec {
  id: PrimaryResourceId;
  max: number;
  // later: regenRate, combatRegenRate, etc.
}

export interface ClassDefinition {
  id: ClassId;
  displayName: string;
  shortName?: string; // e.g. "Warlord"
  description: string;
  archetype: ClassArchetype;
  combatRole?: CombatRole;

  primaryResource: PrimaryResourceId;
  secondaryResource?: PrimaryResourceId | null;

  // v0: base stats at level 1 (we can tune these later class-by-class)
  baseAttributes: Attributes;

  // Per-level attribute gains (this is what PostgresCharacterService is using now)
  perLevel: Attributes;

  armorTypes: string[]; // e.g. ["cloth"], ["leather"], ["mail"], ["plate"]
  weaponFamilies: string[]; // e.g. ["sword_1h","axe_2h","bow","staff"]

  // Future hooks (songs, spell trees, etc.)
  favoredSpellSchools?: string[]; // ["fire","arcane"], ["shadow","disease"], ...
  favoredWeaponSkills?: string[]; // ["one_handed","two_handed"], ...

  // NEW: resource + song hooks
  powerResources?: PowerResourceSpec[];
  isSongCaster?: boolean;
  maxSongSlots?: number;
}

// Convenience default base stats (we’ll override per-class as we tune)
const BASE_10: Attributes = {
  str: 10,
  agi: 10,
  int: 10,
  sta: 10,
  wis: 10,
  cha: 10,
};

// ---- Per-level gains table (lifted from PostgresCharacterService + new classes) ----

const CLASS_PER_LEVEL: Record<ClassId, Attributes> = {
  // Bard – Paladin/Rogue hybrid, Agi-leaning, musical / charisma
  virtuoso: { str: 1, agi: 2, int: 1, sta: 1, wis: 1, cha: 2 },

  // Enchanter – Priest/Warlock, Int-biased support/control
  illusionist: { str: 0, agi: 1, int: 3, sta: 1, wis: 2, cha: 2 },

  // Monk – Rogue/Warrior, Agi > Sta > Str
  ascetic: { str: 1, agi: 3, int: 0, sta: 2, wis: 0, cha: 1 },

  // Shaman – Priest/Mage, Int > “Spi” (wis)
  prophet: { str: 0, agi: 1, int: 2, sta: 1, wis: 3, cha: 1 },

  // Paladin – Sta-heavy tank
  crusader: { str: 1, agi: 1, int: 1, sta: 3, wis: 2, cha: 1 },

  // Shadow Knight – Str > Sta > Int
  revenant: { str: 3, agi: 0, int: 1, sta: 2, wis: 0, cha: 1 },

  // Druid – Spi > Int > Sta
  hierophant: { str: 0, agi: 1, int: 2, sta: 1, wis: 3, cha: 1 },

  // Warrior – baseline physical
  warlord: { str: 2, agi: 1, int: 0, sta: 2, wis: 0, cha: 1 },

  // Cleric – Spi > Sta
  templar: { str: 0, agi: 0, int: 1, sta: 2, wis: 3, cha: 1 },

  // Necromancer – Int-dominant
  defiler: { str: 0, agi: 0, int: 3, sta: 1, wis: 2, cha: 1 },

  // Magician – balanced pet caster (Mage/Warlock mix)
  conjuror: { str: 0, agi: 1, int: 3, sta: 1, wis: 2, cha: 1 },

  // Wizard – glass cannon
  archmage: { str: 0, agi: 0, int: 4, sta: 1, wis: 2, cha: 0 },

  // Rogue – baseline physical DPS, very Agi/Cha
  cutthroat: { str: 1, agi: 3, int: 1, sta: 1, wis: 0, cha: 2 },

  // Berserker – Str > Sta
  ravager: { str: 4, agi: 1, int: 0, sta: 2, wis: 0, cha: 0 },

  // Beastlord – Monk/Shaman hybrid
  primalist: { str: 2, agi: 2, int: 1, sta: 2, wis: 2, cha: 1 },

  // Ranger – Agi-ranged hybrid
  outrider: { str: 1, agi: 3, int: 2, sta: 1, wis: 1, cha: 1 },

  // Adventurer – chaos baseline, even growth everywhere
  adventurer: { str: 1, agi: 1, int: 1, sta: 1, wis: 1, cha: 1 },

  // Warlock – demon pet caster, Int + Sta heavy
  warlock: { str: 0, agi: 0, int: 3, sta: 2, wis: 2, cha: 1 },

  // Hunter – agile ranged pet class
  hunter: { str: 1, agi: 3, int: 1, sta: 2, wis: 1, cha: 1 },

  // Death Knight – decay plate; Str/Sta heavy with a bit of Int
  runic_knight: { str: 3, agi: 0, int: 1, sta: 3, wis: 0, cha: 1 },

  // Generic fallback / unknown classes
  default: { str: 1, agi: 1, int: 1, sta: 1, wis: 1, cha: 1 },

  // Temporary aliases for simple names we’re using right now:
  warrior: { str: 2, agi: 1, int: 0, sta: 2, wis: 0, cha: 1 },
  mage: { str: 0, agi: 0, int: 3, sta: 1, wis: 2, cha: 1 },
  rogue: { str: 1, agi: 3, int: 1, sta: 1, wis: 0, cha: 2 },
  priest: { str: 0, agi: 0, int: 1, sta: 2, wis: 3, cha: 1 },
};

// ---- Full class definitions (v0 placeholders for base stats / gear) ----

export const CLASS_DEFINITIONS: Record<ClassId, ClassDefinition> = {
  virtuoso: {
    id: "virtuoso",
    displayName: "Virtuoso",
    description: "Agile battle-bard weaving songs and steel.",
    archetype: "hybrid",
    combatRole: "dps",
    primaryResource: "mana", // later: song meter + mana?
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.virtuoso,
    armorTypes: ["leather"],
    weaponFamilies: ["sword_1h", "dagger", "mace_1h"],
    favoredSpellSchools: ["arcane", "holy"],
    favoredWeaponSkills: ["one_handed"],
    // NEW: Virtuoso is our first real song caster
    isSongCaster: true,
    maxSongSlots: 3,
    powerResources: [{ id: "mana", max: 100 }],
  },

  illusionist: {
    id: "illusionist",
    displayName: "Illusionist",
    description: "Control, charm, and disable with mind magic.",
    archetype: "support",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.illusionist,
    armorTypes: ["cloth"],
    weaponFamilies: ["staff", "wand", "dagger"],
    favoredSpellSchools: ["arcane", "shadow"],
  },

  ascetic: {
    id: "ascetic",
    displayName: "Ascetic",
    description: "Monk-style martial artist; fists and focus.",
    archetype: "melee_dps",
    combatRole: "dps",
    primaryResource: "fury", // later could split to “chi”
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.ascetic,
    armorTypes: ["leather"],
    weaponFamilies: ["unarmed", "staff", "fist_weapon"],
  },

  prophet: {
    id: "prophet",
    displayName: "Prophet",
    description: "Elemental shaman / spiritual caster hybrid.",
    archetype: "hybrid",
    combatRole: "healer",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.prophet,
    armorTypes: ["mail"],
    weaponFamilies: ["mace_1h", "staff", "totem"],
    favoredSpellSchools: ["nature", "fire"],
  },

  crusader: {
    id: "crusader",
    displayName: "Crusader",
    description: "Paladin analogue: holy plate tank/support.",
    archetype: "tank",
    combatRole: "tank",
    primaryResource: "mana",
    // you explicitly wanted pal/sk using mana
    powerResources: [{ id: "mana", max: 100 }],
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.crusader,
    armorTypes: ["plate"],
    weaponFamilies: ["sword_1h", "mace_1h", "shield", "sword_2h"],
    favoredSpellSchools: ["holy"],
  },

  revenant: {
    id: "revenant",
    displayName: "Revenant",
    description: "Shadow knight: decay knight with curses.",
    archetype: "tank",
    combatRole: "tank",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.revenant,
    armorTypes: ["plate"],
    weaponFamilies: ["sword_2h", "axe_2h", "mace_2h"],
    favoredSpellSchools: ["shadow", "disease"],
  },

  hierophant: {
    id: "hierophant",
    displayName: "Hierophant",
    description: "Nature priest; druid-flavored healer/caster.",
    archetype: "healer",
    combatRole: "healer",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.hierophant,
    armorTypes: ["leather"],
    weaponFamilies: ["staff", "mace_1h"],
    favoredSpellSchools: ["nature"],
  },

  warlord: {
    id: "warlord",
    displayName: "Warlord",
    description: "Front-line plate brawler; lives on fury.",
    archetype: "tank",
    combatRole: "tank",
    primaryResource: "fury",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.warlord,
    armorTypes: ["mail", "plate"],
    weaponFamilies: [
      "sword_1h",
      "axe_1h",
      "mace_1h",
      "shield",
      "sword_2h",
      "axe_2h",
      "mace_2h",
    ],
    favoredWeaponSkills: ["one_handed", "two_handed"],
    powerResources: [{ id: "mana", max: 100 }],
  },

  templar: {
    id: "templar",
    displayName: "Templar",
    description: "Heavy-armor cleric; heals while armored up.",
    archetype: "healer",
    combatRole: "healer",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.templar,
    armorTypes: ["mail", "plate"],
    weaponFamilies: ["mace_1h", "staff", "shield"],
    favoredSpellSchools: ["holy"],
  },

  defiler: {
    id: "defiler",
    displayName: "Defiler",
    description: "Necromancer analogue; pets and rot.",
    archetype: "ranged_dps",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.defiler,
    armorTypes: ["cloth"],
    weaponFamilies: ["staff", "wand", "dagger"],
    favoredSpellSchools: ["shadow", "disease"],
  },

  conjuror: {
    id: "conjuror",
    displayName: "Conjuror",
    description: "Elemental pet mage; summons friends and fire.",
    archetype: "ranged_dps",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.conjuror,
    armorTypes: ["cloth"],
    weaponFamilies: ["staff", "wand", "dagger"],
    favoredSpellSchools: ["fire", "earth"],
  },

  archmage: {
    id: "archmage",
    displayName: "Archmage",
    description: "Classic glass cannon wizard.",
    archetype: "ranged_dps",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.archmage,
    armorTypes: ["cloth"],
    weaponFamilies: ["staff", "wand", "dagger"],
    favoredSpellSchools: ["arcane", "fire", "frost"],
  },

  cutthroat: {
    id: "cutthroat",
    displayName: "Cutthroat",
    description: "Stabby rogue; high agility and charisma.",
    archetype: "melee_dps",
    combatRole: "dps",
    primaryResource: "fury",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.cutthroat,
    armorTypes: ["leather"],
    weaponFamilies: ["dagger", "sword_1h"],
  },

  ravager: {
    id: "ravager",
    displayName: "Ravager",
    description: "Berserker who loves crits more than life.",
    archetype: "melee_dps",
    combatRole: "dps",
    primaryResource: "fury",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.ravager,
    armorTypes: ["mail", "plate"],
    weaponFamilies: ["axe_2h", "sword_2h", "mace_2h"],
  },

  primalist: {
    id: "primalist",
    displayName: "Primalist",
    description: "Beastlord-style pet brawler.",
    archetype: "hybrid",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.primalist,
    armorTypes: ["leather", "mail"],
    weaponFamilies: ["fist_weapon", "staff", "spear", "axe_1h"],
  },

  outrider: {
    id: "outrider",
    displayName: "Outrider",
    description: "Ranger; agile ranged hybrid.",
    archetype: "ranged_dps",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.outrider,
    armorTypes: ["leather", "mail"],
    weaponFamilies: ["bow", "crossbow", "sword_1h", "axe_1h"],
  },

  adventurer: {
    id: "adventurer",
    displayName: "Adventurer",
    description: "Chaos wildcard class; gains random stuff.",
    archetype: "hybrid",
    combatRole: "dps",
    primaryResource: "mana",
    // later: both mana + fury special-case
    secondaryResource: "fury",
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.adventurer,
    armorTypes: ["cloth", "leather", "mail"], // intentionally wide
    weaponFamilies: ["sword_1h", "mace_1h", "staff", "bow", "dagger"],
    powerResources: [
      { id: "mana", max: 100 },
      { id: "fury", max: 100 },
    ],
  },

  warlock: {
    id: "warlock",
    displayName: "Warlock",
    description: "Demon pact caster with damage-over-time.",
    archetype: "ranged_dps",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.warlock,
    armorTypes: ["cloth"],
    weaponFamilies: ["staff", "wand", "dagger"],
    favoredSpellSchools: ["shadow", "fire"],
  },

  hunter: {
    id: "hunter",
    displayName: "Hunter",
    description: "Ranged pet class; bows and beasts.",
    archetype: "ranged_dps",
    combatRole: "dps",
    primaryResource: "mana", // v1: spells-based hunter kit
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.hunter,
    armorTypes: ["leather", "mail"],
    weaponFamilies: ["bow", "crossbow", "gun", "sword_1h", "axe_1h"],
    powerResources: [{ id: "mana", max: 100 }],
  },

  runic_knight: {
    id: "runic_knight",
    displayName: "Runic Knight",
    description: "Runic knight; plate + dark magic.",
    archetype: "tank",
    combatRole: "tank",
    primaryResource: "fury", // using fury-ish resource for now
    secondaryResource: "mana", // for spellcasting hooks later
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.runic_knight,
    armorTypes: ["plate"],
    weaponFamilies: [
      "sword_2h",
      "axe_2h",
      "mace_2h",
      "sword_1h",
      "axe_1h",
    ],
    favoredSpellSchools: ["shadow", "frost"],
    powerResources: [
      { id: "fury", max: 100 },
      { id: "mana", max: 100 },
    ],
  },

  // ---- Debug / legacy aliases ----

  warrior: {
    id: "warrior",
    displayName: "Warrior (Legacy)",
    description: "Debug warrior archetype.",
    archetype: "tank",
    combatRole: "tank",
    primaryResource: "fury",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.warrior,
    armorTypes: ["mail", "plate"],
    weaponFamilies: [
      "sword_1h",
      "axe_1h",
      "mace_1h",
      "shield",
      "sword_2h",
      "axe_2h",
    ],
    powerResources: [{ id: "fury", max: 100 }],
  },

  mage: {
    id: "mage",
    displayName: "Mage (Legacy)",
    description: "Debug mage archetype.",
    archetype: "ranged_dps",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.mage,
    armorTypes: ["cloth"],
    weaponFamilies: ["staff", "wand"],
    powerResources: [{ id: "mana", max: 100 }],
  },

  rogue: {
    id: "rogue",
    displayName: "Rogue (Legacy)",
    description: "Debug rogue archetype.",
    archetype: "melee_dps",
    combatRole: "dps",
    primaryResource: "fury",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.rogue,
    armorTypes: ["leather"],
    weaponFamilies: ["dagger", "sword_1h"],
    powerResources: [{ id: "fury", max: 100 }],
  },

  priest: {
    id: "priest",
    displayName: "Priest (Legacy)",
    description: "Debug priest archetype.",
    archetype: "healer",
    combatRole: "healer",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.priest,
    armorTypes: ["cloth"],
    weaponFamilies: ["staff", "mace_1h"],
    powerResources: [{ id: "mana", max: 100 }],
  },

  default: {
    id: "default",
    displayName: "Unknown",
    description: "Fallback class definition.",
    archetype: "hybrid",
    combatRole: "dps",
    primaryResource: "mana",
    secondaryResource: null,
    baseAttributes: BASE_10,
    perLevel: CLASS_PER_LEVEL.default,
    armorTypes: ["cloth"],
    weaponFamilies: [],
  },
};

// ---- Public helpers ----

function inferCombatRoleFromArchetype(archetype: ClassArchetype): CombatRole | undefined {
  switch (archetype) {
    case "tank":
      return "tank";
    case "healer":
      return "healer";
    default:
      return "dps";
  }
}

export function getClassDefinition(id: string): ClassDefinition {
  const key = ((id || "default").toLowerCase() as ClassId) || "default";
  return CLASS_DEFINITIONS[key] ?? CLASS_DEFINITIONS.default;
}

export function getCombatRoleForClass(id: string): CombatRole | undefined {
  const def = getClassDefinition(id);
  return def.combatRole ?? inferCombatRoleFromArchetype(def.archetype);
}

export function getPerLevelAttributesForClass(id: string): Attributes {
  const key = ((id || "default").toLowerCase() as ClassId) || "default";
  return CLASS_PER_LEVEL[key] ?? CLASS_PER_LEVEL.default;
}

export function getPrimaryResourceForClass(id: string): PrimaryResourceId {
  return getClassDefinition(id).primaryResource;
}

// NEW: helper for power resource metadata
export function getPowerResourcesForClass(id: string): PowerResourceSpec[] {
  return getClassDefinition(id).powerResources ?? [];
}

export function getAllClassDefinitions(): ClassDefinition[] {
  return Object.values(CLASS_DEFINITIONS);
}
