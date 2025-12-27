//backend/src/domain/city.ts

import type { RegionId } from "./world";

export type BuildingKind = "housing" | "farmland" | "mine" | "arcane_spire";

export interface CityBuilding {
  id: string;
  kind: BuildingKind;
  level: number;
  name: string;
}

export interface CityStats {
  population: number;
  stability: number;
  prosperity: number;
  security: number;
  infrastructure: number;
  arcaneSaturation: number;
  influence: number;
  unity: number;
}

export interface City {
  id: string;
  ownerId: string;
  name: string;
  shardId: string;
  regionId: RegionId;
  tier: number;
  maxBuildingSlots: number;
  stats: CityStats;
  buildings: CityBuilding[];

  // New: specialization / prestige
  specializationId?: string;   // e.g. "food_star" | "materials_star"
  specializationStars: number; // 0 = none, 1+ = how many loops

  // Lifetime stars per spec (for UI & logic later)
  specializationStarsHistory: Record<string, number>;

}

// ---- Production helpers ----

export interface BuildingProduction {
  food?: number;
  materials?: number;
  wealth?: number;
  mana?: number;
  knowledge?: number;
  unity?: number;
}

// per-building production
export function getBuildingProductionPerTick(
  b: CityBuilding
): BuildingProduction {
  const lvl = b.level;

  switch (b.kind) {
    case "farmland":
      return { food: 5 * lvl };

    case "mine":
      return { materials: 4 * lvl, wealth: 1 * lvl };

    case "arcane_spire":
      return { mana: 2 * lvl, knowledge: 1 * lvl };

    case "housing":
      return { unity: 1 * lvl };

    default:
      return {};
  }
}

export function getCityProductionPerTick(city: City): BuildingProduction {
  const total: BuildingProduction = {};

  for (const b of city.buildings) {
    const p = getBuildingProductionPerTick(b);
    if (p.food) total.food = (total.food ?? 0) + p.food;
    if (p.materials) total.materials = (total.materials ?? 0) + p.materials;
    if (p.wealth) total.wealth = (total.wealth ?? 0) + p.wealth;
    if (p.mana) total.mana = (total.mana ?? 0) + p.mana;
    if (p.knowledge) total.knowledge = (total.knowledge ?? 0) + p.knowledge;
    if (p.unity) total.unity = (total.unity ?? 0) + p.unity;
  }

  return total;
}

// ---- Upgrade costs ----

export interface BuildingUpgradeCost {
  materials: number;
  wealth: number;
}

// simple cost formula per building kind
export function getBuildingUpgradeCost(b: CityBuilding): BuildingUpgradeCost {
  // base cost per kind
  let baseMaterials = 0;
  let baseWealth = 0;

  switch (b.kind) {
    case "housing":
      baseMaterials = 20;
      baseWealth = 10;
      break;
    case "farmland":
      baseMaterials = 15;
      baseWealth = 5;
      break;
    case "mine":
      baseMaterials = 25;
      baseWealth = 15;
      break;
    case "arcane_spire":
      baseMaterials = 30;
      baseWealth = 25;
      break;
    default:
      baseMaterials = 10;
      baseWealth = 5;
      break;
  }

  // scale cost by current level (more expensive each tier)
  const mult = 1 + b.level * 0.5;

  return {
    materials: Math.round(baseMaterials * mult),
    wealth: Math.round(baseWealth * mult),
  };
}

// ---- Construction costs + slots ----

export interface BuildingConstructionCost {
  materials: number;
  wealth: number;
}

// base construction cost for a *new* building
export function getBuildingConstructionCost(
  kind: BuildingKind
): BuildingConstructionCost {
  switch (kind) {
    case "housing":
      return { materials: 30, wealth: 10 };
    case "farmland":
      return { materials: 20, wealth: 5 };
    case "mine":
      return { materials: 40, wealth: 15 };
    case "arcane_spire":
      return { materials: 50, wealth: 25 };
    default:
      return { materials: 20, wealth: 5 };
  }
}

// how many total buildings a city can have at a given tier
export function maxBuildingSlotsForTier(tier: number): number {
  switch (tier) {
    case 1: // hamlet
      return 6;
    case 2: // town
      return 12;
    case 3: // city
      return 20;
    case 4: // capital
      return 28;
    default:
      return 6;
  }
}

// small helper to generate a name per kind
function defaultNameForBuilding(kind: BuildingKind, index: number): string {
  switch (kind) {
    case "housing":
      return `Residential Block ${index}`;
    case "farmland":
      return `Farmland Parcel ${index}`;
    case "mine":
      return `Extraction Site ${index}`;
    case "arcane_spire":
      return `Arcane Spire ${index}`;
    default:
      return `Structure ${index}`;
  }
}

// create a brand-new building of a given kind for a city
export function createBuilding(kind: BuildingKind, city: City): CityBuilding {
  const ofSameKind = city.buildings.filter((b) => b.kind === kind).length;
  const index = ofSameKind + 1;

  const id = `b_${kind}_${Date.now()}_${Math.floor(
    Math.random() * 100000
  )}`;

  return {
    id,
    kind,
    level: 1,
    name: defaultNameForBuilding(kind, index),
  };
}

// Starter city for the demo player
export function seedStarterCity(ownerId: string): City {
  return {
    id: "city_0001",
    ownerId,
    name: "Prime Bastion",
    shardId: "prime_shard",
    // satisfy RegionId for now
    regionId: "ancient_elwynn" as RegionId,
    tier: 1,
    specializationId: undefined,
    specializationStars: 0,
    specializationStarsHistory: {},
    maxBuildingSlots: 6,
    stats: {
      population: 500,
      stability: 70,
      prosperity: 55,
      security: 40,
      infrastructure: 35,
      arcaneSaturation: 20,
      influence: 10,
      unity: 15,
    },
    buildings: [
      {
        id: "b_housing_1",
        kind: "housing",
        level: 1,
        name: "Low Quarter",
      },
      {
        id: "b_farmland_1",
        kind: "farmland",
        level: 1,
        name: "Outer Farmlands",
      },
      {
        id: "b_mine_1",
        kind: "mine",
        level: 1,
        name: "Hill Quarry",
      },
      {
        id: "b_arcane_1",
        kind: "arcane_spire",
        level: 1,
        name: "Arcane Spire",
      },
    ],
  };
}
