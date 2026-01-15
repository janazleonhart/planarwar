// worldcore/sim/TownTierSeeding.ts
//
// Pure helpers for assigning town tiers during seeding.
// Keep this deterministic and testable (no DB access).

import type { Bounds } from "./SimGrid";

/**
 * Map normalized distance [0..1] to an integer tier in [minTier..maxTier],
 * where 0 = closest to center => highest tier (maxTier),
 * and 1 = farthest => lowest tier (minTier).
 *
 * Buckets are equal-width across [0..1]:
 *   buckets = (maxTier - minTier + 1)
 *   [0..1/b) => maxTier
 *   [1/b..2/b) => maxTier-1
 *   ...
 *   [ (b-1)/b .. 1 ] => minTier
 */
export function tierFromNormalizedDistance(
  norm: number,
  minTier: number,
  maxTier: number,
): number {
  const minT = Math.max(1, Math.floor(minTier));
  const maxT = Math.max(minT, Math.floor(maxTier));
  const buckets = maxT - minT + 1;

  const n = Number.isFinite(norm) ? Math.min(1, Math.max(0, norm)) : 0;

  // Ensure norm=1 lands in last bucket.
  const idx = Math.min(buckets - 1, Math.floor(n * buckets));
  const tier = maxT - idx;

  return Math.min(maxT, Math.max(minT, tier));
}

/**
 * Compute the farthest distance from (centerX, centerZ) to any corner of the bounds.
 * Bounds are cell coordinates; cellSize converts to world-space.
 */
export function maxDistanceInBounds(
  bounds: Bounds,
  cellSize: number,
  centerX: number,
  centerZ: number,
): number {
  const cs = Math.max(1, Math.floor(cellSize || 64));

  const minX = bounds.minCx * cs;
  const maxX = (bounds.maxCx + 1) * cs;
  const minZ = bounds.minCz * cs;
  const maxZ = (bounds.maxCz + 1) * cs;

  const corners: Array<[number, number]> = [
    [minX, minZ],
    [minX, maxZ],
    [maxX, minZ],
    [maxX, maxZ],
  ];

  let maxD = 0;
  for (const [x, z] of corners) {
    const dx = x - centerX;
    const dz = z - centerZ;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > maxD) maxD = d;
  }
  return maxD;
}

/**
 * Assign a tier for a point using distance mode.
 */
export function tierForPointDistanceMode(opts: {
  x: number;
  z: number;
  bounds: Bounds;
  cellSize: number;
  centerX: number;
  centerZ: number;
  minTier: number;
  maxTier: number;
}): number {
  const maxD = maxDistanceInBounds(opts.bounds, opts.cellSize, opts.centerX, opts.centerZ);
  const dx = opts.x - opts.centerX;
  const dz = opts.z - opts.centerZ;
  const d = Math.sqrt(dx * dx + dz * dz);
  const norm = maxD > 0 ? d / maxD : 0;

  return tierFromNormalizedDistance(norm, opts.minTier, opts.maxTier);
}
