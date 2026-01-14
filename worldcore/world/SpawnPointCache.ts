// worldcore/world/SpawnPointCache.ts
/**
 * Lightweight in-memory cache of spawn_points entries.
 *
 * Goal:
 * - Allow runtime systems (NPC respawn, live editing tools, etc.) to consult
 *   the most recently known spawn point coordinates without touching the DB.
 *
 * Safety:
 * - No IO, no DB. Safe in unit tests.
 */

import type { DbSpawnPoint } from "./SpawnPointService";

export type SpawnPointCacheEntry = {
  id: number;
  shardId: string;
  spawnId: string;
  type: string;

  protoId: string;
  variantId: string | null;
  archetype: string | null;
  regionId: string | null;

  x: number | null;
  y: number | null;
  z: number | null;

  updatedAtMs: number;
};

const CACHE = new Map<number, SpawnPointCacheEntry>();

export function upsertSpawnPoint(p: DbSpawnPoint): void {
  const now = Date.now();
  CACHE.set(p.id, {
    id: p.id,
    shardId: p.shardId,
    spawnId: p.spawnId,
    type: p.type,
    protoId: p.protoId,
    variantId: p.variantId ?? null,
    archetype: (p as any).archetype ?? null,
    regionId: p.regionId ?? null,
    x: typeof p.x === "number" ? p.x : p.x ?? null,
    y: typeof p.y === "number" ? p.y : p.y ?? null,
    z: typeof p.z === "number" ? p.z : p.z ?? null,
    updatedAtMs: now,
  });
}

export function upsertSpawnPoints(points: DbSpawnPoint[]): void {
  for (const p of points) upsertSpawnPoint(p);
}

export function getSpawnPoint(spawnPointId: number): SpawnPointCacheEntry | undefined {
  return CACHE.get(spawnPointId);
}

/**
 * Dev/test helper: override coordinates for an entry (creates if missing).
 * Useful for behavior tests that simulate live spawn point edits.
 */
export function setSpawnPointCoords(
  spawnPointId: number,
  coords: { x?: number | null; y?: number | null; z?: number | null },
): void {
  const now = Date.now();
  const cur = CACHE.get(spawnPointId);
  CACHE.set(spawnPointId, {
    id: spawnPointId,
    shardId: cur?.shardId ?? "unknown",
    spawnId: cur?.spawnId ?? `sp_${spawnPointId}`,
    type: cur?.type ?? "unknown",
    protoId: cur?.protoId ?? "unknown",
    variantId: cur?.variantId ?? null,
    archetype: cur?.archetype ?? null,
    regionId: cur?.regionId ?? null,
    x: coords.x !== undefined ? coords.x : cur?.x ?? null,
    y: coords.y !== undefined ? coords.y : cur?.y ?? null,
    z: coords.z !== undefined ? coords.z : cur?.z ?? null,
    updatedAtMs: now,
  });
}

export function clearSpawnPointCache(): void {
  CACHE.clear();
}
