// worldcore/terrain/regions/RegionDifficulty.ts

import { Region } from "./RegionTypes";

export function getRegionTier(region: Region): number {
  const x = region.centerX;
  const z = region.centerZ;
  const dist = Math.sqrt(x * x + z * z);
  const max = 2048; // world radius

  const t = dist / max; // 0.0 (center) → 1.0 (edge)

  if (t < 0.2) return 1; // starter band
  if (t < 0.4) return 2;
  if (t < 0.6) return 3;
  if (t < 0.8) return 4;
  return 5;              // far / dangerous band
}
