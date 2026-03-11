// web-backend/routes/adminSpawnPoints/bulkMutationOps.ts

import { db } from "../../../worldcore/db/Database";

type EditableQueryRow = {
  id?: unknown;
  spawn_id?: unknown;
  owner_kind?: unknown;
  is_locked?: unknown;
};

function isEditableRow(row: EditableQueryRow, isSpawnEditable: (spawnId: string) => boolean): boolean {
  if (Boolean(row.is_locked)) return false;
  const spawnId = String(row.spawn_id ?? "");
  const ownerKind = String(row.owner_kind ?? "").trim().toLowerCase();
  const isEditorOwned = ownerKind === "editor";
  return isEditorOwned || isSpawnEditable(spawnId);
}

async function loadEditableSpawnPointIds(params: {
  shardId: string;
  ids: number[];
  isSpawnEditable: (spawnId: string) => boolean;
}): Promise<number[]> {
  const { shardId, ids, isSpawnEditable } = params;
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const rows = await db.query(
    `
      SELECT id, spawn_id, owner_kind, is_locked
      FROM spawn_points
      WHERE shard_id = $1 AND id = ANY($2::int[])
    `,
    [shardId, ids],
  );

  return (rows.rows ?? [])
    .filter((row: EditableQueryRow) => isEditableRow(row, isSpawnEditable))
    .map((row: EditableQueryRow) => Number(row.id))
    .filter((id: number) => Number.isFinite(id) && id > 0);
}

export async function deleteEditableSpawnPoints(params: {
  shardId: string;
  ids: number[];
  isSpawnEditable: (spawnId: string) => boolean;
}): Promise<{ deleted: number; skipped: number }> {
  const { shardId, ids, isSpawnEditable } = params;
  const deletable = await loadEditableSpawnPointIds({ shardId, ids, isSpawnEditable });
  if (deletable.length === 0) {
    return { deleted: 0, skipped: ids.length };
  }

  const del = await db.query(
    `DELETE FROM spawn_points WHERE shard_id = $1 AND id = ANY($2::int[])`,
    [shardId, deletable],
  );

  return {
    deleted: Number(del.rowCount ?? deletable.length),
    skipped: ids.length - deletable.length,
  };
}

export async function moveEditableSpawnPoints(params: {
  shardId: string;
  ids: number[];
  dx: number;
  dy: number;
  dz: number;
  isSpawnEditable: (spawnId: string) => boolean;
}): Promise<{ moved: number; skipped: number }> {
  const { shardId, ids, dx, dy, dz, isSpawnEditable } = params;
  const movable = await loadEditableSpawnPointIds({ shardId, ids, isSpawnEditable });
  if (movable.length === 0) {
    return { moved: 0, skipped: ids.length };
  }

  const upd = await db.query(
    `
      UPDATE spawn_points
      SET
        x = CASE WHEN x IS NULL THEN NULL ELSE x + $3 END,
        y = CASE WHEN y IS NULL THEN (CASE WHEN $4 = 0 THEN NULL ELSE $4 END) ELSE y + $4 END,
        z = CASE WHEN z IS NULL THEN NULL ELSE z + $5 END
      WHERE shard_id = $1
        AND id = ANY($2::int[])
    `,
    [
      shardId,
      movable,
      Number.isFinite(dx) ? dx : 0,
      Number.isFinite(dy) ? dy : 0,
      Number.isFinite(dz) ? dz : 0,
    ],
  );

  return {
    moved: Number(upd.rowCount ?? movable.length),
    skipped: ids.length - movable.length,
  };
}
