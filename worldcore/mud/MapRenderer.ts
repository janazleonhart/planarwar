// worldcore/mud/MapRenderer.ts

import { ServerWorldManager } from "../world/ServerWorldManager";
import type { CharacterState } from "../characters/CharacterTypes";

const MIN_RADIUS = 2;
const MAX_RADIUS = 10;

function clampRadius(r?: number): number {
  if (r === undefined || Number.isNaN(r)) return 5; // default 11x11
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, r));
}

function biomeToGlyph(biome: string | undefined): string {
  switch (biome) {
    case "plains":       return ".";
    case "forest":       return "f";
    case "high_forest":  return "F";
    case "hills":        return "^";
    case "road":         return "=";
    case "river":        return "~";   // swimmers welcome
    default:             return " ";
  }
}

/**
 * Build an ANSI-compatible map string centered on the character.
 * Currently uses RegionMap biomes; later we can fold in height/cliffs.
 */
export function buildAsciiMap(
  world: ServerWorldManager | undefined,
  char: CharacterState,
  requestedRadius?: number
): string {
  if (!world) {
    return "The world is unavailable.";
  }

  const radius = clampRadius(requestedRadius);

  const rows: string[] = [];

  for (let dz = -radius; dz <= radius; dz++) {
    let line = "";
    for (let dx = -radius; dx <= radius; dx++) {
      const x = char.posX + dx;
      const z = char.posZ + dz;

      if (dx === 0 && dz === 0) {
        line += "@"; // you
        continue;
      }

      const region = world.getRegionAt(x, z);
      if (!region) {
        line += " "; // outside shard
        continue;
      }

      line += biomeToGlyph(region.biome);
    }
    rows.push(line);
  }

  const legend = [
    "",
    "Legend:",
    "@ = you",
    ". = plains, f/F = forest",
    "^ = hills, = = road",
    "~ = river (swimmable)"
  ];

  return rows.join("\n") + "\n" + legend.join("\n");
}
