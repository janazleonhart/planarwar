// web-backend/routes/adminSpawnPoints/snapshotQueryFilters.ts

import type { SnapshotSpawnRow } from "./snapshotStore";
import { buildWhereFromQueryFilters, type BulkOwnershipQuery } from "./bulkOwnershipOps";

type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";

type QueryFilterHelpers = {
  numOrNull: (v: unknown) => number | null;
  strOrNull: (v: unknown) => string | null;
  normalizeAuthority: (v: unknown) => SpawnAuthority | null;
};

export type SpawnPointQueryFilters = BulkOwnershipQuery & {
  shardId: string;
};

export function parseSpawnPointQueryFilters(source: any, helpers: QueryFilterHelpers): SpawnPointQueryFilters {
  const { numOrNull, strOrNull, normalizeAuthority } = helpers;
  return {
    shardId: String(source?.shardId ?? "prime_shard").trim() || "prime_shard",
    regionId: strOrNull(source?.regionId),
    x: numOrNull(source?.x),
    z: numOrNull(source?.z),
    radius: numOrNull(source?.radius),
    authority: normalizeAuthority(source?.authority),
    type: strOrNull(source?.type),
    archetype: strOrNull(source?.archetype),
    protoId: strOrNull(source?.protoId),
    spawnId: strOrNull(source?.spawnId),
  };
}

export function buildSpawnPointWhere(args: {
  filters: SpawnPointQueryFilters;
  helpers: QueryFilterHelpers;
}): { whereSql: string; args: any[] } {
  return buildWhereFromQueryFilters({
    shardId: args.filters.shardId,
    query: args.filters,
    numOrNull: args.helpers.numOrNull,
    strOrNull: args.helpers.strOrNull,
    normalizeAuthority: args.helpers.normalizeAuthority,
  });
}

export function buildSpawnPointListQuery(args: {
  filters: SpawnPointQueryFilters;
  limit: number;
  helpers: QueryFilterHelpers;
}): { sql: string; args: any[] } {
  const { whereSql, args: whereArgs } = buildSpawnPointWhere({ filters: args.filters, helpers: args.helpers });
  const params = [...whereArgs, args.limit];
  const sql = `
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
        town_tier,
        owner_kind,
        owner_id,
        is_locked
      FROM spawn_points
      WHERE ${whereSql}
      ORDER BY id ASC
      LIMIT $${params.length}
    `;
  return { sql, args: params };
}

export async function loadSnapshotRowsByQuery(args: {
  db: { query: (sql: string, params?: any[]) => Promise<{ rows?: any[] }> };
  filters: SpawnPointQueryFilters;
  maxRows: number;
  helpers: QueryFilterHelpers;
}): Promise<{ total: number; spawns: SnapshotSpawnRow[] }> {
  const { db, filters, maxRows, helpers } = args;
  const { whereSql, args: whereArgs } = buildSpawnPointWhere({ filters, helpers });
  const countSql = `SELECT COUNT(1)::int AS n FROM spawn_points WHERE ${whereSql}`;
  const countRes = await db.query(countSql, whereArgs);
  const total = Number(countRes.rows?.[0]?.n ?? 0);
  if (total <= 0) {
    return { total, spawns: [] };
  }

  const sql = `
      SELECT
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
      WHERE ${whereSql}
      ORDER BY id ASC
      LIMIT ${Math.max(1, Math.trunc(maxRows))}
    `;
  const rowsRes = await db.query(sql, whereArgs);
  const spawns: SnapshotSpawnRow[] = (rowsRes.rows || []).map((r: any) => ({
    shardId: String(r.shard_id),
    spawnId: String(r.spawn_id),
    type: String(r.type),
    protoId: String(r.proto_id ?? ""),
    archetype: String(r.archetype),
    variantId: r.variant_id ? String(r.variant_id) : null,
    x: Number(r.x ?? 0),
    y: Number(r.y ?? 0),
    z: Number(r.z ?? 0),
    regionId: String(r.region_id ?? ""),
    townTier: r.town_tier === null || r.town_tier === undefined ? null : Number(r.town_tier),
  }));
  return { total, spawns };
}
