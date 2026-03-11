//web-backend/routes/adminSpawnPoints/singleOwnershipOps.ts

import { db } from "../../../worldcore/db/Database";

export type SpawnOwnerKind = "brain" | "baseline" | "editor" | "system";
export type SingleOwnershipAction = "adopt" | "release" | "lock" | "unlock";

export async function readSpawnPointRowById(id: number): Promise<any | null> {
  const r = await db.query(
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
      town_tier,
      owner_kind,
      owner_id,
      is_locked
    FROM spawn_points
    WHERE id = $1
    LIMIT 1
    `,
    [id],
  );
  return r.rows?.[0] ?? null;
}

export function computeDefaultOwnerKindForSpawnId(spawnId: string): SpawnOwnerKind | null {
  const sid = String(spawnId ?? "").trim().toLowerCase();
  if (sid.startsWith("seed:")) return "baseline";
  if (sid.startsWith("brain:")) return "brain";
  return null;
}

export async function applySingleOwnershipAction(args: {
  id: number;
  action: SingleOwnershipAction;
  ownerId?: string | null;
  spawnId?: string | null;
}): Promise<void> {
  const { id, action } = args;

  if (action === "adopt") {
    await db.query(
      `
      UPDATE spawn_points
      SET
        owner_kind = 'editor',
        owner_id = $2,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id, args.ownerId ?? null],
    );
    return;
  }

  if (action === "release") {
    const nextOwner = computeDefaultOwnerKindForSpawnId(String(args.spawnId ?? ""));
    await db.query(
      `
      UPDATE spawn_points
      SET
        owner_kind = $2,
        owner_id = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id, nextOwner],
    );
    return;
  }

  if (action === "lock") {
    await db.query(
      `
      UPDATE spawn_points
      SET
        is_locked = TRUE,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id],
    );
    return;
  }

  await db.query(
    `
    UPDATE spawn_points
    SET
      is_locked = FALSE,
      updated_at = NOW()
    WHERE id = $1
    `,
    [id],
  );
}
