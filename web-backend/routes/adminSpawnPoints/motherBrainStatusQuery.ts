// web-backend/routes/adminSpawnPoints/motherBrainStatusQuery.ts

import type { WorldBox } from "./opsPreview";
import { queryMotherBrainBoxRows } from "./motherBrainBoxQuery";

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

export async function queryMotherBrainStatusRows(dbLike: Queryable, args: MotherBrainStatusQueryArgs): Promise<MotherBrainStatusRow[]> {
  const rows = await queryMotherBrainBoxRows(dbLike, args);
  return rows.map((row) => ({
    spawn_id: row.spawn_id,
    type: row.type,
    proto_id: row.proto_id,
    region_id: row.region_id,
  }));
}
