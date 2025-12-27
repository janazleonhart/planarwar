// backend/src/domain/tech.ts

// Tech Categories: What are the main trees other techs go under
export type TechCategory =
  | "infrastructure"  // roads, buildings, utilities
  | "agriculture"     // food and land use for farming/herbing gardens
  | "military"        // armies, weapons, fortifications
  | "civics"          // laws, governance, policies
  | "population"      // housing, demographics, migration
  | "magic"           // arcane systems, wards, rituals
  | "travel"          // logistics, caravans, portals
  | "husbandry"       // careful management and cultivation of resources
  | "gathering"       // gathering of resources outside of farms
  | "security"        // policing, intel, internal order
  | "seafaring";      // things about the sea and naval battles

// Tech Age: what your city can actually work with.
export type TechAge =
  | "wood"
  | "stone"
  | "bronze"
  | "iron"
  | "steel"
  | "magical"
  | "planar";

// Planar War meta-era buckets. These can mirror Genesis / Rebirth / Apex / UDM, etc.
export type TechEpoch = "genesis" | "rebirth" | "apex" | "udm";

// Lightweight tags for grouping/filtering later (UI, AI, etc.)
export type TechTag =
  | "city"
  | "economy"
  | "military"
  | "arcane"
  | "planar"
  | "illegal"  // Black Market Players Only
  | "lair";    // UDM Players Only

export interface TechDefinition {
  id: string;
  name: string;
  description: string;
  category: TechCategory;
  cost: number;
  prerequisites?: string[];

  // 🔹 Age: what tier of material/civilization this belongs to
  age?: TechAge;

  // 🔹 Epoch: optional shard meta-gate (use later if you want)
  epoch?: TechEpoch;

  // 🔹 Feature / faction flags (black market, UDM, etc.)
  unlockFlags?: string[];

  // 🔹 For filtering, UI, AI
  tags?: TechTag[];
}

// v1: starter tech web with prereqs.
// Later we’ll extend this into the full graph.
const TECHS: TechDefinition[] = [
  // === INFRASTRUCTURE: city capacity & resilience ===

  {
    id: "urban_planning_1",
    name: "Urban Planning I",
    description:
      "Basic zoning and street grids increase building capacity and improve infrastructure.",
    category: "infrastructure",
    cost: 100,
    age: "wood",
    epoch: "genesis",
    tags: ["city", "economy"],
  },
  {
    id: "urban_planning_2",
    name: "Urban Planning II",
    description:
      "District planning, service routes and better civic layout increase capacity and prosperity.",
    category: "infrastructure",
    cost: 220,
    prerequisites: ["urban_planning_1"],
    age: "stone",
    epoch: "genesis",
    tags: ["city", "economy"],
  },
  {
    id: "urban_planning_3",
    name: "Urban Planning III",
    description:
      "Advanced civic planning, redundancy and defenses make the city far more resilient.",
    category: "infrastructure",
    cost: 400,
    prerequisites: ["urban_planning_2"],
    age: "bronze",
    epoch: "rebirth",
    tags: ["city", "economy"],
  },

  {
    id: "district_roads_1",
    name: "District Roads I",
    description:
      "Packed earth roads and simple bridges make movement inside the city faster.",
    category: "infrastructure",
    cost: 120,
    age: "wood",
    epoch: "genesis",
    tags: ["city", "economy"],
  },
  {
    id: "district_roads_2",
    name: "District Roads II",
    description:
      "Stone-paved arteries and reinforced bridges support heavier trade and troop movement.",
    category: "infrastructure",
    cost: 260,
    prerequisites: ["district_roads_1"],
    age: "stone",
    epoch: "genesis",
    tags: ["city", "economy"],
  },

  // === AGRICULTURE: food & stability ===

  {
    id: "advanced_agriculture_1",
    name: "Field Stewardship I",
    description:
      "Crop rotation and irrigation boost yields and stabilize food supply.",
    category: "agriculture",
    cost: 100,
    age: "wood",
    epoch: "genesis",
    tags: ["economy"],
  },
  {
    id: "advanced_agriculture_2",
    name: "Field Stewardship II",
    description:
      "Specialized agronomy, seed stock and storage make famine far less likely.",
    category: "agriculture",
    cost: 220,
    prerequisites: ["advanced_agriculture_1"],
    age: "stone",
    epoch: "rebirth",
    tags: ["economy"],
  },
  {
    id: "irrigation_canals_1",
    name: "Irrigation Canals",
    description:
      "Dug channels and sluice gates extend fertile land and protect against dry seasons.",
    category: "agriculture",
    cost: 180,
    prerequisites: ["advanced_agriculture_1"],
    age: "stone",
    epoch: "genesis",
    tags: ["economy"],
  },

  // === HUSBANDRY: animals & cultivated resources ===

  {
    id: "animal_husbandry_1",
    name: "Animal Husbandry I",
    description:
      "Organized pens and breeding increase yields of meat, leather and draft animals.",
    category: "husbandry",
    cost: 120,
    age: "wood",
    epoch: "genesis",
    tags: ["economy"],
  },
  {
    id: "animal_husbandry_2",
    name: "Animal Husbandry II",
    description:
      "Selective breeding and better fodder improve reliability of mounts and pack animals.",
    category: "husbandry",
    cost: 260,
    prerequisites: ["animal_husbandry_1"],
    age: "stone",
    epoch: "rebirth",
    tags: ["economy"],
  },

  // === GATHERING: logging, mining, foraging ===

  {
    id: "logging_camps_1",
    name: "Logging Camps",
    description:
      "Permanent camps and simple sawpits increase the output of usable timber.",
    category: "gathering",
    cost: 110,
    age: "wood",
    epoch: "genesis",
    tags: ["economy"],
  },
  {
    id: "surface_mining_1",
    name: "Surface Mining",
    description:
      "Organized pits and tailings management improve extraction of ore and stone.",
    category: "gathering",
    cost: 180,
    age: "stone",
    epoch: "genesis",
    tags: ["economy"],
  },

  // === POPULATION: housing, basic welfare ===

  {
    id: "basic_sanitation",
    name: "Basic Sanitation",
    description:
      "Simple sewers, refuse pits and wash basins reduce disease and unrest.",
    category: "population",
    cost: 140,
    age: "wood",
    epoch: "genesis",
    tags: ["city"],
  },
  {
    id: "public_wells",
    name: "Public Wells",
    description:
      "Shared wells and cisterns ensure more reliable access to clean water.",
    category: "population",
    cost: 220,
    prerequisites: ["basic_sanitation"],
    age: "stone",
    epoch: "genesis",
    tags: ["city"],
  },

  // === CIVICS: governance, tax, institutions ===

  {
    id: "local_councils",
    name: "Local Councils",
    description:
      "Neighborhood elders and councils provide a buffer for grievances before they reach the palace.",
    category: "civics",
    cost: 150,
    age: "wood",
    epoch: "genesis",
    tags: ["city"],
  },
  {
    id: "chartered_guilds",
    name: "Chartered Guilds",
    description:
      "Granting charters to guilds stabilizes craft output and tax collection at the cost of some autonomy.",
    category: "civics",
    cost: 260,
    prerequisites: ["local_councils"],
    age: "stone",
    epoch: "rebirth",
    tags: ["city", "economy"],
  },

  // === MILITARY: troops & fortifications ===

  {
    id: "militia_training_1",
    name: "Militia Drills I",
    description:
      "Regular drills and basic doctrine improve militia responsiveness.",
    category: "military",
    cost: 100,
    age: "wood",
    epoch: "genesis",
    tags: ["military"],
  },
  {
    id: "militia_training_2",
    name: "Militia Drills II",
    description:
      "Standardized drills and cadre training harden your forces and defenses.",
    category: "military",
    cost: 220,
    prerequisites: ["militia_training_1"],
    age: "stone",
    epoch: "rebirth",
    tags: ["military"],
  },
  {
    id: "basic_fortifications",
    name: "Basic Fortifications",
    description:
      "Earthen ramparts, ditches and timber palisades harden the city against raids.",
    category: "military",
    cost: 260,
    prerequisites: ["militia_training_1"],
    age: "stone",
    epoch: "genesis",
    tags: ["military"],
  },

  // === SECURITY: watch, intel, internal order ===

  {
    id: "city_watch_1",
    name: "City Watch Charter",
    description:
      "Formalizing the watch as a civic institution improves day-to-day order.",
    category: "security",
    cost: 140,
    age: "wood",
    epoch: "genesis",
    tags: ["city", "military"],
  },
  {
    id: "informant_network_1",
    name: "Informant Network",
    description:
      "Trusted eyes and ears in taverns and markets provide early warning of trouble.",
    category: "security",
    cost: 260,
    prerequisites: ["city_watch_1"],
    age: "stone",
    epoch: "rebirth",
    tags: ["city", "military"],
  },

  // === MAGIC: wards, ley knowledge ===

  {
    id: "minor_wards_1",
    name: "Minor Wards",
    description:
      "Simple wardstones and charms protect key districts against stray planar bleed.",
    category: "magic",
    cost: 220,
    age: "magical",
    epoch: "genesis",
    tags: ["arcane", "city"],
  },
  {
    id: "ley_survey_1",
    name: "Ley Survey I",
    description:
      "Mapping nearby ley lines makes it easier to site spires and ritual grounds.",
    category: "magic",
    cost: 320,
    prerequisites: ["minor_wards_1"],
    age: "magical",
    epoch: "rebirth",
    tags: ["arcane", "city"],
  },

  // === TRAVEL: caravans, river trade ===

  {
    id: "caravan_trails_1",
    name: "Caravan Trails",
    description:
      "Recognized trails and waystations lower the risk of overland trade routes.",
    category: "travel",
    cost: 150,
    age: "wood",
    epoch: "genesis",
    tags: ["economy"],
  },
  {
    id: "river_barges_1",
    name: "River Barges",
    description:
      "Standardized barges and river tolls turn waterways into arteries of commerce.",
    category: "travel",
    cost: 260,
    prerequisites: ["caravan_trails_1"],
    age: "stone",
    epoch: "rebirth",
    tags: ["economy"],
  },

  // === BLACK MARKET SAMPLE (illegal) ===

  {
    id: "black_market_contacts_1",
    name: "Black Market Contacts",
    description:
      "Quietly cultivate ties with smugglers and shadow brokers who move goods no chartered guild will touch.",
    category: "civics",
    cost: 200,
    age: "stone",
    epoch: "rebirth",
    unlockFlags: ["BLACK_MARKET_ENABLED"],
    tags: ["illegal", "economy"],
  },

  // === UDM / LAIR SAMPLE (planar) ===

  {
    id: "lair_mobilization_1",
    name: "Lair Mobilization",
    description:
      "Organize lair-bound forces into something resembling a standing army.",
    category: "military",
    cost: 260,
    age: "planar",
    epoch: "udm",
    unlockFlags: ["UDM_VISIBLE"],
    tags: ["lair", "military", "planar"],
  },
];

export function getAllTechDefs(): TechDefinition[] {
  return TECHS;
}

export function getTechById(id: string): TechDefinition | undefined {
  return TECHS.find((t) => t.id === id);
}

// We keep this generic to avoid circular imports.
export interface TechPlayerLike {
  researchedTechIds: string[];
}

// Context is optional so existing callers don’t break.
// currentAge = global “floor”, categoryAges lets you be steel in population,
// stone in military, etc.
export interface TechAvailabilityContext {
  currentAge?: TechAge;
  currentEpoch?: TechEpoch;
  enabledFlags?: string[];
  categoryAges?: Partial<Record<TechCategory, TechAge>>;
}

// v1: everything not yet researched, prereqs + age/epoch/flags satisfied.
export function getAvailableTechsForPlayer(
  player: TechPlayerLike,
  ctx: TechAvailabilityContext = {}
): TechDefinition[] {
  const researched = new Set(player.researchedTechIds ?? []);
  const { currentAge, currentEpoch, enabledFlags, categoryAges } = ctx;
  const flagsSet = new Set(enabledFlags ?? []);

  return TECHS.filter((t) => {
    if (researched.has(t.id)) return false;

    // 🔹 Effective age: per-category if defined, else global
    const effectiveAge =
      (categoryAges && categoryAges[t.category]) || currentAge;

    if (t.age && effectiveAge && t.age !== effectiveAge) {
      return false;
    }

    // 🔹 Epoch gating (only if you actually set both)
    if (t.epoch && currentEpoch && t.epoch !== currentEpoch) {
      return false;
    }

    // 🔹 Feature flags
    if (t.unlockFlags && t.unlockFlags.length > 0) {
      const hasAny = t.unlockFlags.some((f) => flagsSet.has(f));
      if (!hasAny) return false;
    }

    // 🔹 Prereqs
    if (!t.prerequisites || t.prerequisites.length === 0) return true;
    return t.prerequisites.every((pr) => researched.has(pr));
  });
}
