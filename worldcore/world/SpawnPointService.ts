// worldcore/world/SpawnPointService.ts

import { db } from "../db/Database";

/**
 * Raw row shape from the spawn_points table.
 *
 *   id SERIAL PRIMARY KEY,
 *   shard_id TEXT,
 *   spawn_id TEXT,
 *   type TEXT,
 *   archetype TEXT,
 *   x REAL, y REAL, z REAL,
 *   region_id TEXT
 */
 export interface SpawnPointRow {
  id: number;
  shard_id: string;
  spawn_id: string;
  type: string;
  archetype: string;

  proto_id: string | null;      // NEW
  variant_id: string | null;    // NEW

  x: number | null;
  y: number | null;
  z: number | null;
  region_id: string | null;
}


/**
 * Runtime-friendly spawn point type.
 *
 * We keep this separate so we can evolve it later (e.g. add metadata,
 * spawn weights, tags, etc.) without changing the DB schema.
 */
 export interface DbSpawnPoint {
  id: number;
  shardId: string;
  spawnId: string;
  type: string;

  // NEW (futureproof identity)
  protoId: string;              // canonical identity
  variantId: string | null;     // optional incarnation/version

  // Legacy (keep for now; useful for resources)
  archetype: string;

  x: number | null;
  y: number | null;
  z: number | null;
  regionId: string | null;
}

function rowToSpawnPoint(row: SpawnPointRow): DbSpawnPoint {
  const protoId = row.proto_id ?? row.archetype; // fallback
  return {
    id: row.id,
    shardId: row.shard_id,
    spawnId: row.spawn_id,
    type: row.type,

    protoId,
    variantId: row.variant_id ?? null,

    archetype: row.archetype,

    x: row.x,
    y: row.y,
    z: row.z,
    regionId: row.region_id,
  };
}

/**
 * Simple service over the spawn_points table.
 *
 * v1 scope:
 *  - lookup by regionId
 *  - lookup by world-space radius (x/z circle)
 */
export class SpawnPointService {
  /**
   * Get all spawn points for a given shard + region.
   *
   * regionId should match regions.region_id, which lines up with the
   * Region.id from ServerWorldManager (e.g. "prime_shard:-1,-1").
   */
  async getSpawnPointsForRegion(
    shardId: string,
    regionId: string
  ): Promise<DbSpawnPoint[]> {
    const res = await db.query<SpawnPointRow>(
      `
      SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id
      FROM spawn_points
      WHERE shard_id = $1
        AND region_id = $2
      ORDER BY id
      `,
      [shardId, regionId]
    );

    return res.rows.map(rowToSpawnPoint);
  }

  /**
   * Get all spawn points near a given world-space (x, z) within a radius.
   *
   * Uses a simple x/z circle:
   *   (x - cx)^2 + (z - cz)^2 <= radius^2
   */
  async getSpawnPointsNear(
    shardId: string,
    x: number,
    z: number,
    radius: number
  ): Promise<DbSpawnPoint[]> {
    const safeRadius = Math.max(0, Math.min(radius, 10_000));
    const r2 = safeRadius * safeRadius;

    const res = await db.query<SpawnPointRow>(
      `
      SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id
      FROM spawn_points
      WHERE shard_id = $1
        AND x IS NOT NULL
        AND z IS NOT NULL
        AND ((x - $2) * (x - $2) + (z - $3) * (z - $3)) <= $4
      ORDER BY id
      `,
      [shardId, x, z, r2]
    );

    return res.rows.map(rowToSpawnPoint);
  }
}
