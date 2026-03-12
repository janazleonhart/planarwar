// web-backend/routes/adminSpawnPoints/motherBrainBoxQuery.ts

import type { WorldBox } from "./opsPreview";

export type MotherBrainBoxRow = {
  id?: unknown;
  spawn_id?: unknown;
  type?: unknown;
  proto_id?: unknown;
  region_id?: unknown;
};

export type MotherBrainBoxNormalizedRow = {
  id: number | null;
  spawn_id: string;
  type: string;
  proto_id: string | null;
  region_id: string | null;
};

export type MotherBrainBoxQueryArgs = {
  shardId: string;
  box: WorldBox;
};

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>;
};

function strOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

export function normalizeMotherBrainBoxRow(row: MotherBrainBoxRow): MotherBrainBoxNormalizedRow {
  const id = Number(row?.id);
  return {
    id: Number.isFinite(id) ? id : null,
    spawn_id: String(row?.spawn_id ?? ""),
    type: String(row?.type ?? ""),
    proto_id: strOrNull(row?.proto_id),
    region_id: strOrNull(row?.region_id),
  };
}

export async function queryMotherBrainBoxRows(dbLike: Queryable, args: MotherBrainBoxQueryArgs): Promise<MotherBrainBoxNormalizedRow[]> {
  const { shardId, box } = args;
  const rowsRes = await dbLike.query(
    `
      SELECT id, spawn_id, type, proto_id, region_id
      FROM spawn_points
      WHERE shard_id = $1
        AND spawn_id LIKE 'brain:%'
        AND x >= $2 AND x <= $3
        AND z >= $4 AND z <= $5
    `,
    [shardId, box.minX, box.maxX, box.minZ, box.maxZ],
  );

  return (rowsRes.rows ?? []).map((row) => normalizeMotherBrainBoxRow(row));
}

export async function queryMotherBrainBoxIds(
  dbLike: Queryable,
  args: MotherBrainBoxQueryArgs,
): Promise<{ ids: number[]; spawnIds: string[] }> {
  const rows = await queryMotherBrainBoxRows(dbLike, args);
  return {
    ids: rows.map((row) => row.id).filter((id): id is number => Number.isFinite(id)),
    spawnIds: rows.map((row) => row.spawn_id).filter(Boolean),
  };
}
