// worldcore/pets/PetProfiles.ts
//
// Pet Engine v1.3:
// - Data-driven pet "classes" (profiles) resolved from petClass and/or tags.
// - Stances remain the behavior axis; profiles affect stats/multipliers.

export interface PetProfile {
  id: string;
  hpMult: number;
  dmgMult: number;
  tags?: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const PROFILES: Record<string, PetProfile> = {
  beast: { id: "beast", hpMult: 1.1, dmgMult: 1.0, tags: ["beast"] },
  undead: { id: "undead", hpMult: 1.0, dmgMult: 1.05, tags: ["undead"] },
  demon: { id: "demon", hpMult: 0.95, dmgMult: 1.15, tags: ["demon"] },
  elemental: { id: "elemental", hpMult: 0.9, dmgMult: 1.2, tags: ["elemental"] },
  construct: { id: "construct", hpMult: 1.25, dmgMult: 0.9, tags: ["construct"] },
  default: { id: "default", hpMult: 1.0, dmgMult: 1.0, tags: ["pet"] },
};

export function resolvePetProfile(pet: any): PetProfile {
  const cls = String(pet?.petClass ?? "").trim().toLowerCase();
  if (cls && PROFILES[cls]) return PROFILES[cls];

  const tags: string[] = Array.isArray(pet?.petTags) ? pet.petTags : Array.isArray(pet?.tags) ? pet.tags : [];
  for (const t of tags) {
    const k = String(t ?? "").trim().toLowerCase();
    if (k && PROFILES[k]) return PROFILES[k];
  }

  return PROFILES.default;
}

export function applyProfileToPetVitals(pet: any): void {
  const p = resolvePetProfile(pet);
  const maxHp = typeof pet?.maxHp === "number" ? pet.maxHp : typeof pet?.hp === "number" ? pet.hp : 40;
  const nextMax = Math.max(1, Math.round(maxHp * clamp(p.hpMult, 0.1, 10)));
  pet.maxHp = nextMax;
  if (typeof pet.hp !== "number") pet.hp = nextMax;
  else pet.hp = Math.min(pet.hp, nextMax);
  // Ensure base tag exists
  if (!Array.isArray(pet.petTags)) pet.petTags = [];
  const set = new Set(pet.petTags.map((x: any) => String(x)));
  for (const t of p.tags ?? []) set.add(t);
  set.add("pet");
  pet.petTags = Array.from(set.values());
}

export function getProfileDamageMult(pet: any): number {
  const p = resolvePetProfile(pet);
  return clamp(p.dmgMult, 0.1, 10);
}
