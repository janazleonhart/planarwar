// web-backend/routes/adminSpawnPoints/motherBrainWipeApply.ts

export type MotherBrainWipeRow = {
  id?: unknown;
  spawn_id?: unknown;
  type?: unknown;
  proto_id?: unknown;
  region_id?: unknown;
};

export type MotherBrainWipeListRow = {
  spawnId: string;
  type: string;
  protoId: string | null;
  regionId: string | null;
};

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function buildMotherBrainWipeSpawnMap(
  rows: MotherBrainWipeRow[],
): Map<string, { id: number; row: MotherBrainWipeListRow }> {
  const bySpawnId = new Map<string, { id: number; row: MotherBrainWipeListRow }>();

  for (const r of rows ?? []) {
    const id = Number(r?.id);
    const spawnId = typeof r?.spawn_id === "string" ? r.spawn_id : "";
    if (!spawnId) continue;
    if (!Number.isFinite(id)) continue;

    bySpawnId.set(spawnId, {
      id,
      row: {
        spawnId,
        type: typeof r?.type === "string" ? r.type : "",
        protoId: toOptionalString(r?.proto_id),
        regionId: toOptionalString(r?.region_id),
      },
    });
  }

  return bySpawnId;
}

export async function applyMotherBrainWipeDelete(args: {
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> };
  ids: number[];
  commit: boolean;
}): Promise<number> {
  const { client, ids, commit } = args;
  if (!commit || ids.length === 0) return 0;
  await client.query(`DELETE FROM spawn_points WHERE id = ANY($1::int[])`, [ids]);
  return ids.length;
}
