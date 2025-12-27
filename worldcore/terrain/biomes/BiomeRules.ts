//worldcore/terrain/biomes/BiomeRules.ts
import { WorldDimensions } from "../../../../planarwar-backend/src/worldgen/WorldDimensions";

export interface BiomeResult {
  biome: string;
  height: number;
  slope: number;
}

export function computeBiome(
  x: number,
  z: number,
  height: number,
  slope: number,
  dim: WorldDimensions
): BiomeResult {
  // scale-aware thresholds
  const scale = dim.worldRadius / 10000;  // normalize

  const low = -4 * scale;
  const high = 20 * scale;

  if (slope < 0.1 && Math.abs(x) % 300 < 6) return { biome: "road", height, slope };
  if (height < low && slope < 0.5) return { biome: "river", height, slope };
  if (slope > 1.6) return { biome: "hills", height, slope };
  if (height > high) return { biome: "high_forest", height, slope };
  if (height < 3) return { biome: "plains", height, slope };

  return { biome: "forest", height, slope };
}
