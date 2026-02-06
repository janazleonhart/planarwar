// worldcore/pets/PetProfiles.ts
//
// Pet Engine v1.4 (Role Profiles):
// - A pet has a *role* (pet_tank / pet_dps / pet_heal / pet_utility) that defines
//   the gameplay baseline.
// - A pet may also have a *skin/species* tag (beast/undead/demon/elemental/construct)
//   that lightly nudges the baseline.
//
// The intended layering is:
//   finalMult = roleMult * speciesMult
//
// NOTE: Gear scaling is handled elsewhere (pets/PetGear.ts) so PetProfiles stays
// pure and deterministic.

export type PetRoleId = "pet_tank" | "pet_dps" | "pet_heal" | "pet_utility";

export interface PetProfile {
  id: string;
  hpMult: number;
  dmgMult: number;
  tags?: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Gameplay baseline (few profiles, tuned centrally)
const ROLE_PROFILES: Record<PetRoleId, PetProfile> = {
  pet_tank: { id: "pet_tank", hpMult: 1.45, dmgMult: 0.85, tags: ["pet", "tank"] },
  pet_dps: { id: "pet_dps", hpMult: 1.00, dmgMult: 1.20, tags: ["pet", "dps"] },
  pet_heal: { id: "pet_heal", hpMult: 0.95, dmgMult: 0.60, tags: ["pet", "heal"] },
  pet_utility: { id: "pet_utility", hpMult: 1.05, dmgMult: 0.90, tags: ["pet", "utility"] },
};

// Flavor/species nudges (optional, and intentionally small)
const SPECIES_PROFILES: Record<string, PetProfile> = {
  beast: { id: "beast", hpMult: 1.05, dmgMult: 1.00, tags: ["beast"] },
  undead: { id: "undead", hpMult: 1.00, dmgMult: 1.05, tags: ["undead"] },
  demon: { id: "demon", hpMult: 0.98, dmgMult: 1.10, tags: ["demon"] },
  elemental: { id: "elemental", hpMult: 0.95, dmgMult: 1.12, tags: ["elemental"] },
  construct: { id: "construct", hpMult: 1.15, dmgMult: 0.95, tags: ["construct"] },
};

const DEFAULT_ROLE: PetRoleId = "pet_dps";
const DEFAULT_SPECIES: PetProfile = { id: "default", hpMult: 1.0, dmgMult: 1.0, tags: ["pet"] };

function normalizeTag(x: any): string {
  return String(x ?? "").trim().toLowerCase();
}

function readTags(pet: any): string[] {
  const tags: any[] = Array.isArray(pet?.petTags)
    ? pet.petTags
    : Array.isArray(pet?.tags)
      ? pet.tags
      : [];
  return tags.map(normalizeTag).filter(Boolean);
}

function resolveRole(pet: any): PetProfile {
  const direct = normalizeTag(pet?.petRole);
  if (direct && (ROLE_PROFILES as any)[direct]) return (ROLE_PROFILES as any)[direct];

  // Back-compat: some older summon payloads used petClass to convey behavior.
  const cls = normalizeTag(pet?.petClass);
  if (cls && (ROLE_PROFILES as any)[cls]) return (ROLE_PROFILES as any)[cls];

  // Tags can also carry role.
  for (const t of readTags(pet)) {
    if ((ROLE_PROFILES as any)[t]) return (ROLE_PROFILES as any)[t];
  }

  return ROLE_PROFILES[DEFAULT_ROLE];
}

function resolveSpecies(pet: any): PetProfile {
  const cls = normalizeTag(pet?.petClass);
  if (cls && SPECIES_PROFILES[cls]) return SPECIES_PROFILES[cls];

  for (const t of readTags(pet)) {
    if (t && SPECIES_PROFILES[t]) return SPECIES_PROFILES[t];
  }

  return DEFAULT_SPECIES;
}

export function resolvePetRoleId(pet: any): PetRoleId {
  const p = resolveRole(pet);
  return (p.id as PetRoleId) || DEFAULT_ROLE;
}

export function resolvePetProfiles(pet: any): { role: PetProfile; species: PetProfile } {
  return { role: resolveRole(pet), species: resolveSpecies(pet) };
}

export function applyProfileToPetVitals(pet: any): void {
  const { role, species } = resolvePetProfiles(pet);

  const baseMaxHp =
    typeof pet?.maxHp === "number"
      ? pet.maxHp
      : typeof pet?.hp === "number"
        ? pet.hp
        : 40;

  const hpMult = clamp(role.hpMult * species.hpMult, 0.1, 10);
  const nextMax = Math.max(1, Math.round(baseMaxHp * hpMult));

  pet.maxHp = nextMax;
  if (typeof pet.hp !== "number") pet.hp = nextMax;
  else pet.hp = Math.min(pet.hp, nextMax);

  // Ensure tags exist
  if (!Array.isArray(pet.petTags)) pet.petTags = [];
  const set = new Set(pet.petTags.map((x: any) => String(x)));
  set.add("pet");

  // Persist identity tags for UI/filters/debug.
  set.add(role.id);
  for (const t of role.tags ?? []) set.add(t);
  if (species.id !== "default") {
    set.add(species.id);
    for (const t of species.tags ?? []) set.add(t);
  }

  pet.petTags = Array.from(set.values());
  pet.petRole = role.id;
}

/**
 * Outgoing damage multiplier from role + species.
 * (Does not include gear; see pets/PetGear.ts.)
 */
export function getProfileDamageMult(pet: any): number {
  const { role, species } = resolvePetProfiles(pet);
  return clamp(role.dmgMult * species.dmgMult, 0.1, 10);
}
