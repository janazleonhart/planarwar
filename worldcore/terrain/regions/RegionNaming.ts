// worldcore/terrain/regions/RegionNaming.ts

import { Region } from "./RegionTypes";
import { Rng } from "../../utils/Rng";

const PLAIN_NOUNS = ["Fields", "Meadows", "Downs", "Pasture", "Steppe", "Expanse"];
const FOREST_NOUNS = ["Woods", "Thicket", "Grove", "Copse", "Wilds"];
const HILL_NOUNS = ["Hills", "Ridges", "Uplands", "Rise"];
const RIVER_NOUNS = ["Banks", "Crossing", "Run", "Reach"];
const COAST_NOUNS = ["Coast", "Shore", "Strand"];
const MOUNTAIN_NOUNS = ["Peaks", "Cliffs", "Heights"];
const SWAMP_NOUNS = ["Bog", "Fen", "Marsh", "Mire"];
const DESERT_NOUNS = ["Dunes", "Wastes", "Barrens"];
const GENERIC_NOUNS = ["Reach", "Marches", "Frontier", "Lowlands"];

// Light adjective list; expand later as needed.
const ADJECTIVES = [
  "Quiet",
  "Whispering",
  "Verdant",
  "Ashen",
  "Broken",
  "Stormlit",
  "Golden",
  "Shadowed",
  "Sunlit",
  "Frosted",
];

function nounsForBiome(biome: string): string[] {
  const b = biome.toLowerCase();
  if (b.includes("plain") || b.includes("grass") || b.includes("field")) return PLAIN_NOUNS;
  if (b.includes("forest") || b.includes("tree") || b.includes("wood")) return FOREST_NOUNS;
  if (b.includes("hill")) return HILL_NOUNS;
  if (b.includes("river") || b.includes("lake") || b.includes("pond")) return RIVER_NOUNS;
  if (b.includes("coast") || b.includes("shore") || b.includes("beach")) return COAST_NOUNS;
  if (b.includes("mountain") || b.includes("cliff")) return MOUNTAIN_NOUNS;
  if (b.includes("swamp") || b.includes("bog") || b.includes("marsh")) return SWAMP_NOUNS;
  if (b.includes("desert") || b.includes("sand")) return DESERT_NOUNS;
  return GENERIC_NOUNS;
}

/**
 * Very simple 8-way compass from world-space center.
 */
function compassForRegion(region: Region): string {
  const x = region.centerX;
  const z = region.centerZ;

  // Near the center: no suffix.
  const distSq = x * x + z * z;
  const nearCenter = distSq < 256 * 256; // within ~256 units of center

  if (nearCenter) return "";

  const angle = Math.atan2(z, x); // z is "north/south", x is "east/west"
  const deg = (angle * 180) / Math.PI;

  if (deg >= -22.5 && deg < 22.5) return "East";
  if (deg >= 22.5 && deg < 67.5) return "North-East";
  if (deg >= 67.5 && deg < 112.5) return "North";
  if (deg >= 112.5 && deg < 157.5) return "North-West";
  if (deg >= 157.5 || deg < -157.5) return "West";
  if (deg >= -157.5 && deg < -112.5) return "South-West";
  if (deg >= -112.5 && deg < -67.5) return "South";
  if (deg >= -67.5 && deg < -22.5) return "South-East";
  return "";
}

/**
 * Generate a deterministic, nice-looking name for a region.
 * Uses worldId + region.id as the RNG seed so it's stable.
 */
export function generateRegionName(region: Region): string {
  const seed = `${region.worldId}:${region.id}`;
  const rng = new Rng(seed);

  const adj = rng.pick(ADJECTIVES);
  const nounList = nounsForBiome(region.biome);
  const noun = rng.pick(nounList);

  const compass = compassForRegion(region);

  if (compass) {
    return `${adj} ${noun} (${compass})`;
  }

  return `${adj} ${noun}`;
}
