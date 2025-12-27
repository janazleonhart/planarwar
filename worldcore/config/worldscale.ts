//worldcore/config/worldscale.ts

// ------------------------------------------------------------
// World scale definitions for Planar War.
//
// These describe how *big* a shard is intended to feel in lore / design,
// plus some high-level movement & logistics knobs.
//
// IMPORTANT:
//  - "live_prime" is the default and is treated as our production / live
//    reference scale. All systems should assume this unless explicitly
//    overridden by PW_WORLD_SCALE.
//  - Dev scales ("dev_tiny", "dev_medium") exist just so worldgen and
//    tests don't have to chew Jupiter-sized chunks all at once.
// ------------------------------------------------------------

export type WorldScaleId = "dev_tiny" | "dev_medium" | "live_prime";

export interface WorldScaleDefinition {
  id: WorldScaleId;
  name: string;
  description: string;

  // Global multiplier applied to distances/areas in abstract systems.
  // 1.0 = live_prime baseline. Dev shards can shrink this.
  scaleMultiplier: number;

  // Absolute world dimensions (conceptual, in meters).
  // These are used by worldgen/layout logic, not as literal grid sizes.
  supercontinentSize: number;
  midContinentSize: number;
  smallIsleSize: number;

  // Rules around traversal / shard transitions.
  allowTeleportation: boolean;
  requireSafeAreaForShardSwap: boolean;

  // Movement baselines (used by movement/combat/econ sims).
  baseWalkSpeed: number;          // m/s
  mountSpeedMultiplier: number;   // * baseWalkSpeed
  magicTravelMultiplier: number;  // * baseWalkSpeed (for portal / blink sims)

  // Macro-scale war / logistics knobs (for AI / invasion sims).
  logisticsScale: number;         // how "expensive" it is to move armies
  invasionStrengthScale: number;  // how strong regional invasions are
  planarRiftFrequency: number;    // relative frequency of rifts/events
  maxSiegeRange: number;          // max range of siege engines (meters)
  airshipRangeMultiplier: number; // * maxSiegeRange for air/naval power
}

// ------------------------------------------------------------
// Live / production shard scale (default)
// ------------------------------------------------------------

const LIVE_PRIME: WorldScaleDefinition = {
  id: "live_prime",
  name: "Prime Shard – Live Scale",
  description:
    "Canonical live shard scale: vast supercontinents, oceanic gaps, and room for pocket shards to hang off the edges.",

  // All other scales are defined relative to this.
  scaleMultiplier: 1.0,

  // These are conceptual dimensions, not literal grid sizes.
  // Think: multiple Earths stitched together. Big enough that
  // no single guild can realistically dominate the whole thing.
  supercontinentSize: 500_000_000, // 500,000 km
  midContinentSize: 50_000_000,    // 50,000 km
  smallIsleSize: 5_000_000,        // 5,000 km

  // Live rules: teleportation exists but with constraints.
  allowTeleportation: true,
  requireSafeAreaForShardSwap: true,

  // These are the movement baselines other systems should tune against.
  baseWalkSpeed: 6.0,          // m/s
  mountSpeedMultiplier: 3.0,   // 18 m/s
  magicTravelMultiplier: 10.0, // 60 m/s effective (portals, etc.)

  // Macro war knobs tuned for "big world, big stakes".
  logisticsScale: 3.5,
  invasionStrengthScale: 5.0,
  planarRiftFrequency: 2.0,
  maxSiegeRange: 1_500,        // 1.5 km
  airshipRangeMultiplier: 12.0 // air/naval threat radius
};

// ------------------------------------------------------------
// Dev shard scales (smaller, but same *shape*)
// ------------------------------------------------------------

const DEV_TINY: WorldScaleDefinition = {
  id: "dev_tiny",
  name: "Dev Tiny Shard",
  description:
    "Pocket-sized shard for local testing. Same rules as live_prime, but heavily shrunk.",

  scaleMultiplier: 0.02, // ~2% of live scale

  supercontinentSize: LIVE_PRIME.supercontinentSize * 0.02,
  midContinentSize: LIVE_PRIME.midContinentSize * 0.02,
  smallIsleSize: LIVE_PRIME.smallIsleSize * 0.02,

  allowTeleportation: LIVE_PRIME.allowTeleportation,
  requireSafeAreaForShardSwap: LIVE_PRIME.requireSafeAreaForShardSwap,

  baseWalkSpeed: LIVE_PRIME.baseWalkSpeed,
  mountSpeedMultiplier: LIVE_PRIME.mountSpeedMultiplier,
  magicTravelMultiplier: LIVE_PRIME.magicTravelMultiplier,

  logisticsScale: LIVE_PRIME.logisticsScale,
  invasionStrengthScale: LIVE_PRIME.invasionStrengthScale,
  planarRiftFrequency: LIVE_PRIME.planarRiftFrequency,
  maxSiegeRange: LIVE_PRIME.maxSiegeRange,
  airshipRangeMultiplier: LIVE_PRIME.airshipRangeMultiplier
};

const DEV_MEDIUM: WorldScaleDefinition = {
  id: "dev_medium",
  name: "Dev Medium Shard",
  description:
    "Mid-sized shard for broader playtests. Still smaller than live, but enough space for multiple fronts.",

  scaleMultiplier: 0.25, // 25% of live scale

  supercontinentSize: LIVE_PRIME.supercontinentSize * 0.25,
  midContinentSize: LIVE_PRIME.midContinentSize * 0.25,
  smallIsleSize: LIVE_PRIME.smallIsleSize * 0.25,

  allowTeleportation: LIVE_PRIME.allowTeleportation,
  requireSafeAreaForShardSwap: LIVE_PRIME.requireSafeAreaForShardSwap,

  baseWalkSpeed: LIVE_PRIME.baseWalkSpeed,
  mountSpeedMultiplier: LIVE_PRIME.mountSpeedMultiplier,
  magicTravelMultiplier: LIVE_PRIME.magicTravelMultiplier,

  logisticsScale: LIVE_PRIME.logisticsScale,
  invasionStrengthScale: LIVE_PRIME.invasionStrengthScale,
  planarRiftFrequency: LIVE_PRIME.planarRiftFrequency,
  maxSiegeRange: LIVE_PRIME.maxSiegeRange,
  airshipRangeMultiplier: LIVE_PRIME.airshipRangeMultiplier
};

// ------------------------------------------------------------
// Registry + helpers
// ------------------------------------------------------------

export const WORLD_SCALES: Record<WorldScaleId, WorldScaleDefinition> = {
  dev_tiny: DEV_TINY,
  dev_medium: DEV_MEDIUM,
  live_prime: LIVE_PRIME
};

/**
 * Default world scale identifier.
 *
 * Live/production intent: "live_prime".
 * Overrideable via PW_WORLD_SCALE for dev boxes.
 */
export const DEFAULT_WORLD_SCALE_ID: WorldScaleId =
  (process.env.PW_WORLD_SCALE as WorldScaleId) || "live_prime";

export function getWorldScale(id?: WorldScaleId): WorldScaleDefinition {
  const key = id ?? DEFAULT_WORLD_SCALE_ID;
  return WORLD_SCALES[key] ?? LIVE_PRIME;
}
