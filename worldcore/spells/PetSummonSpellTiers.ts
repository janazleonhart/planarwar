// worldcore/spells/PetSummonSpellTiers.ts
//
// Small, isolated registration seam so we don't have to churn SpellTypes.ts
// every time we add new summon tiers.
//
// NOTE: SpellTypes.ts must call installPetSummonSpellTiers(SPELLS) once after SPELLS is defined.

import type { SpellDefinition } from "./SpellTypes";

export function installPetSummonSpellTiers(SPELLS: Record<string, SpellDefinition>): void {
  // Hunter – Call Wolf I / II (tiered models)
  SPELLS.hunter_call_wolf_i = {
    id: "hunter_call_wolf_i",
    name: "Summon Wolf I",
    description: "Summons a wolf companion.",
    kind: "summon_pet",
    classId: "hunter",
    minLevel: 1,
    school: "nature",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    summon: { petProtoId: "pet_wolf", petClass: "beast" },
  } as any;

  SPELLS.hunter_call_wolf_ii = {
    id: "hunter_call_wolf_ii",
    name: "Summon Wolf II",
    description: "Summons a stronger wolf companion.",
    kind: "summon_pet",
    classId: "hunter",
    minLevel: 5,
    school: "nature",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    summon: { petProtoId: "pet_wolf_alpha", petClass: "beast" },
  } as any;
}
