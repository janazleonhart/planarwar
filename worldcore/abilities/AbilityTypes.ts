// worldcore/abilities/AbilityTypes.ts

import type { AttackChannel } from "../actions/ActionTypes";
import type { WeaponSkillId, SpellSchoolId } from "../combat/CombatEngine";
import type { PowerResourceKind } from "../mud/MudResources";

export type AbilityKind =
  | "melee_single"
  | "self_buff"
  | "utility_target"
  | "debuff_single_npc"
  | "damage_dot_single_npc"
  | "cleanse_self"
  | "cleanse_single_ally"
  | "dispel_single_npc"
  | "dispel_single_ally"; // later: melee_aoe, spell_single, spell_aoe, etc.

export interface AbilityCleanseDef {
  tags: string[];
  maxToRemove?: number;

  protectedTags?: string[];
  priorityTags?: string[];
  requireTags?: string[];
  excludeTags?: string[];
}

// Lightweight mirror of SpellTypes.statusEffect (kept intentionally small).
// Abilities are still code-defined; this is only used by MudAbilities handlers.
export interface AbilityStatusEffectDef {
  id: string;
  name?: string;

  durationMs: number;
  stacks?: number;
  maxStacks?: number;

  modifiers: Record<string, any>;
  tags?: string[];

  // DOT knobs (if kind = damage_dot_single_npc)
  dot?: {
    tickIntervalMs: number;
    /** If false, perTickDamage uses the full roll (no spreading). Default true. */
    spreadDamageAcrossTicks?: boolean;
  };

  // Optional extended stacking policy fields (forward compatible)
  stackingPolicy?: any;
  stackingGroupId?: string;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;

  // e.g. "warrior"
  classId: string;
  minLevel: number;

  // How this ability should be treated by the combat engine
  kind: AbilityKind;
  channel?: AttackChannel; // "weapon" | "ability" | "spell"

  // For weapon/spell-based scaling later
  weaponSkill?: WeaponSkillId;
  spellSchool?: SpellSchoolId;

  // Resource usage
  resourceType?: PowerResourceKind; // "fury" or "mana" (default per class)
  resourceCost?: number; // how much to spend

  // Simple damage scaling for now
  damageMultiplier?: number; // 1.5 = 50% more than a normal swing
  flatBonus?: number; // +X extra damage

  // Cooldown in milliseconds
  cooldownMs?: number;

  // Optional freeform tags (used by tooling / kits / UI filters)
  tags?: string[];

  // Optional: apply vulnerability to the *caster* when this ability is used
  // (e.g. Reckless Assault: "hit harder but take more damage for a bit")
  selfVulnerabilityStacks?: number;

  // Optional StatusEffect payload (for debuff/DOT ability kinds)
  statusEffect?: AbilityStatusEffectDef;

  // Optional: cleanse/dispel payloads (for cleanse_self / dispel_single_npc)
  cleanse?: AbilityCleanseDef;
  dispel?: AbilityCleanseDef;
}

export const ABILITIES: Record<string, AbilityDefinition> = {
  warrior_power_strike: {
    id: "warrior_power_strike",
    name: "Power Strike",
    description:
      "A heavy single-target melee attack that hits harder than a basic swing.",
    classId: "warrior",
    minLevel: 1,
    kind: "melee_single",
    channel: "ability",
    weaponSkill: "one_handed",
    resourceType: "fury",
    resourceCost: 20,
    damageMultiplier: 1.5,
    cooldownMs: 4000, // 4s cooldown
  },

  warrior_cleave: {
    id: "warrior_cleave",
    name: "Cleave",
    description:
      "A broad swing that will eventually hit multiple enemies (for now it’s just a heavier single hit).",
    classId: "warrior",
    minLevel: 5,
    kind: "melee_single",
    channel: "ability",
    weaponSkill: "one_handed",
    resourceType: "fury",
    resourceCost: 30,
    damageMultiplier: 1.2,
    flatBonus: 3,
    cooldownMs: 6000, // 6s cooldown
  },

  // NEW: trades defense for offense by applying vulnerability to the caster.
  warrior_reckless_assault: {
    id: "warrior_reckless_assault",
    name: "Reckless Assault",
    description:
      "A ferocious strike that trades defense for offense, slightly increasing your vulnerability to incoming damage.",
    classId: "warrior",
    // You can bump this later; 3 is a nice “early but not level 1” unlock.
    minLevel: 3,
    kind: "melee_single",
    channel: "ability",
    weaponSkill: "one_handed",
    resourceType: "fury",
    resourceCost: 30,
    damageMultiplier: 1.8,
    cooldownMs: 6000,
    // For now this is just a flag; the ability handler calls applyVulnerability
    // once when this is non-zero.
    selfVulnerabilityStacks: 1,
  },

  // --- Reference kit (System 5.4): WARLORD L1–10 abilities ---
  warlord_brutal_slam: {
    id: "warlord_brutal_slam",
    name: "Brutal Slam",
    description: "A heavy slam that hits a single target hard.",
    classId: "warlord",
    minLevel: 1,
    kind: "melee_single",
    channel: "ability",
    weaponSkill: "one_handed",
    resourceType: "fury",
    resourceCost: 12,
    damageMultiplier: 1.15,
    flatBonus: 10,
    cooldownMs: 6000,
    tags: ["reference_kit", "warlord", "bruiser"],
  },

  warlord_sunder_blow: {
    id: "warlord_sunder_blow",
    name: "Sunder Blow",
    description: "A vicious strike meant to crack armor and keep pressure on.",
    classId: "warlord",
    minLevel: 4,
    kind: "melee_single",
    channel: "ability",
    weaponSkill: "one_handed",
    resourceType: "fury",
    resourceCost: 10,
    damageMultiplier: 1.05,
    flatBonus: 8,
    cooldownMs: 4500,
    tags: ["reference_kit", "warlord", "bruiser"],
  },

  warlord_bulwark_bash: {
    id: "warlord_bulwark_bash",
    name: "Bulwark Bash",
    description:
      "A shield-heavy bash that trades burst for control and durability.",
    classId: "warlord",
    minLevel: 7,
    kind: "melee_single",
    channel: "ability",
    weaponSkill: "one_handed",
    resourceType: "fury",
    resourceCost: 8,
    damageMultiplier: 0.95,
    flatBonus: 4,
    cooldownMs: 8000,
    tags: ["reference_kit", "warlord", "bruiser"],
  },

  // --- Cutthroat (stealth + theft kit) ---
  cutthroat_stealth: {
    id: "cutthroat_stealth",
    name: "Stealth",
    description:
      "Slip into the shadows. Breaks if you attack, pickpocket, or get caught.",
    classId: "cutthroat",
    minLevel: 1,
    kind: "self_buff",
    channel: "ability",
    // Stealth is a stance/toggle: keep it responsive.
    cooldownMs: 0,
    tags: ["cutthroat", "stealth", "buff"],
  },

  cutthroat_pickpocket: {
    id: "cutthroat_pickpocket",
    name: "Pickpocket",
    description: "Attempt to steal a small amount of gold from a nearby target.",
    classId: "cutthroat",
    minLevel: 2,
    kind: "utility_target",
    channel: "ability",
    cooldownMs: 4000,
    tags: ["cutthroat", "stealth_required", "breaks_stealth", "theft"],
  },

  cutthroat_backstab: {
    id: "cutthroat_backstab",
    name: "Backstab",
    description: "A vicious strike from the shadows.",
    classId: "cutthroat",
    minLevel: 3,
    kind: "melee_single",
    channel: "ability",
    weaponSkill: "one_handed",
    cooldownMs: 6000,
    damageMultiplier: 2.0,
    flatBonus: 6,
    tags: ["cutthroat", "stealth_required", "breaks_stealth", "backstab"],
  },

  // Mug = pickpocket with a damage component.
  cutthroat_mug: {
    id: "cutthroat_mug",
    name: "Mug",
    description:
      "Strike your target and attempt to steal from them in the same motion.",
    classId: "cutthroat",
    minLevel: 5,
    kind: "melee_single",
    channel: "ability",
    weaponSkill: "one_handed",
    cooldownMs: 8000,
    damageMultiplier: 1.25,
    flatBonus: 2,
    tags: ["cutthroat", "stealth_required", "breaks_stealth", "mug", "theft"],
  },
};

export function findAbilityByNameOrId(input: string): AbilityDefinition | null {
  const needle = input.trim().toLowerCase();
  if (!needle) return null;

  // Try id first
  if (ABILITIES[needle]) return ABILITIES[needle];

  // Then by name
  const match = Object.values(ABILITIES).find(
    (a) => a.name.toLowerCase() === needle,
  );

  return match ?? null;
}
