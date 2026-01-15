// worldcore/world/SpawnPointService.ts

/**
 * IMPORTANT:
 * - This module must be safe to import in unit tests.
 * - Database.ts can open sockets / DNS that prevent `node --test` from exiting.
 * - Therefore: lazy-import Database only inside methods, and hard-disable DB access
 *   when WORLDCORE_TEST=1 or Node's test runner is active.
 */
function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

async function getDb(): Promise<any> {
  // IMPORTANT: lazy import (see module docstring)
  const mod = await import("../db/Database");
  return mod.db;
}

/**
 * DB row shape for spawn_points.
 *
 * NOTE: This intentionally matches the DB columns we SELECT.
 *
 * TABLE spawn_points:
 *  id SERIAL PRIMARY KEY,
 *  shard_id TEXT NOT NULL,
 *  spawn_id TEXT NOT NULL,
 *  type TEXT NOT NULL,
 *  archetype TEXT NOT NULL,
 *  proto_id TEXT,
 *  variant_id TEXT,
 *  x REAL,
 *  y REAL,
 *  z REAL,
 *  region_id TEXT
 */
export interface SpawnPointRow {
  id: number;
  shard_id: string;
  spawn_id: string;
  type: string;
  archetype: string;
  proto_id: string | null;
  variant_id: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  region_id: string | null;

  // Optional column; older DBs may not have it yet.
  town_tier?: number | null;
}

/**
 * Runtime-friendly spawn point shape.
 *
 * NOTE: protoId is required canonical identity.
 * If proto_id is null in DB, we default protoId to spawn_id.
 */
export interface DbSpawnPoint {
  id: number;

  shardId: string;
  spawnId: string;
  type: string;

  // NEW (future-proof identity)
  protoId: string; // canonical identity
  variantId: string | null; // optional incarnation/version

  // Legacy (keep for now; useful for resources)
  archetype: string;

  x: number | null;
  y: number | null;
  z: number | null;

  regionId: string | null;

  // Option B: DB-backed town tier (spawn_points.town_tier). Only meaningful for type='town'.
  townTier?: number | null;
}

function rowToSpawnPoint(row: SpawnPointRow): DbSpawnPoint {
  const protoId = row.proto_id ?? row.spawn_id; // fallback canonical id

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
    regionId: row.region_id ?? null,
    townTier: row.town_tier ?? null,
  };
}

/**
 * Simple service over the spawn_points table.
 *
 * NOTE:
 * - During unit tests, this returns empty results and never touches the DB.
 * - The authoritative runtime source of truth is the DB; this is just a thin query layer.
 */
export class SpawnPointService {
  async getSpawnPointsForRegion(
    shardId: string,
    regionId: string,
  ): Promise<DbSpawnPoint[]> {
    if (isNodeTestRuntime()) return [];

    const db = await getDb();
    const res = await db.query(
      `
      SELECT
        id,
        shard_id,
        spawn_id,
        type,
        archetype,
        proto_id,
        variant_id,
        x,
        y,
        z,
        region_id,
        town_tier
      FROM spawn_points
      WHERE shard_id = $1 AND region_id = $2
      ORDER BY id
    `,
      [shardId, regionId],
    );

    return (res.rows as SpawnPointRow[]).map((row) =>
      rowToSpawnPoint(row as SpawnPointRow),
    );
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
    radius: number,
  ): Promise<DbSpawnPoint[]> {
    if (isNodeTestRuntime()) return [];

    const safeRadius = Math.max(0, Math.min(radius, 10_000));
    const r2 = safeRadius * safeRadius;

    const db = await getDb();
    const res = await db.query(
      `
      SELECT
        id,
        shard_id,
        spawn_id,
        type,
        archetype,
        proto_id,
        variant_id,
        x,
        y,
        z,
        region_id,
        town_tier
      FROM spawn_points
      WHERE
        shard_id = $1
        AND x IS NOT NULL
        AND z IS NOT NULL
        AND ((x - $2) * (x - $2) + (z - $3) * (z - $3)) <= $4
      ORDER BY id
    `,
      [shardId, x, z, r2],
    );

    return (res.rows as SpawnPointRow[]).map((row) =>
      rowToSpawnPoint(row as SpawnPointRow),
    );
  }
}
