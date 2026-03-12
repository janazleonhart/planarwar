// web-backend/routes/adminSpawnPoints/motherBrainStatusQuery.ts

import type { WorldBox } from "./opsPreview";

export type MotherBrainStatusQueryArgs = {
  shardId: string;
  box: WorldBox;
};

export type MotherBrainStatusRow = {
  spawn_id: string;
  type: string;
  proto_id: string | null;
  region_id: string | null;
};

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }>;
};

function strOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function normalizeMotherBrainStatusRow(row: Record<string, unknown>): MotherBrainStatusRow {
  return {
    spawn_id: String(row.spawn_id ?? ""),
    type: String(row.type ?? ""),
    proto_id: strOrNull(row.proto_id),
    region_id: strOrNull(row.region_id),
  };
}

export async function queryMotherBrainStatusRows(dbLike: Queryable, args: MotherBrainStatusQueryArgs): Promise<MotherBrainStatusRow[]> {
  const { shardId, box } = args;
  const rowsRes = await dbLike.query(
    `
      SELECT spawn_id, type, proto_id, region_id
      FROM spawn_points
      WHERE shard_id = $1
        AND spawn_id LIKE 'brain:%'
        AND x >= $2 AND x <= $3
        AND z >= $4 AND z <= $5
    `,
    [shardId, box.minX, box.maxX, box.minZ, box.maxZ],
  );

  return (rowsRes.rows ?? []).map((row) => normalizeMotherBrainStatusRow(row));
}
