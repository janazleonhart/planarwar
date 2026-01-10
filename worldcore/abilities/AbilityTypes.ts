// worldcore/abilities/AbilityTypes.ts

import type { AttackChannel } from "../actions/ActionTypes";
import type { WeaponSkillId, SpellSchoolId } from "../combat/CombatEngine";
import type { PowerResourceKind } from "../mud/MudResources";

export type AbilityKind =
  | "melee_single"; // later: melee_aoe, spell_single, spell_aoe, buff, etc.

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

  // Optional: apply vulnerability to the *caster* when this ability is used
  // (e.g. Reckless Assault: "hit harder but take more damage for a bit")
  selfVulnerabilityStacks?: number;
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
};

export function findAbilityByNameOrId(
  input: string,
): AbilityDefinition | null {
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
