//web-backend/routes/adminSpawnPoints/restoreSnapshot.ts

import { db } from "../../../worldcore/db/Database";
import { isSpawnEditable } from "../../../worldcore/world/spawnAuthority";
import {
  addReasonExplainStep,
  buildSpawnSliceOpsPreview,
  makeReasonMaps,
  protectedReason,
  readOnlyReason,
  type SpawnSliceOpsPreview,
} from "./opsPreview";
import type { CellBounds, SnapshotSpawnRow } from "./snapshotStore";

export type ProtectedRestoreMeta = {
  ownerKind: string | null;
  isLocked: boolean;
};

export type RestoreSnapshotPlan = {
  insertIds: string[];
  updateIds: string[];
  protectedUpdateIds: string[];
  skipIds: string[];
  readOnlyIds: string[];
  extraTargetIds: string[];
  extraTargetCount?: number;
  opsPreview: SpawnSliceOpsPreview;
};

export type RestoreSnapshotCounts = {
  inserted: number;
  updated: number;
  skipped: number;
  skippedReadOnly: number;
  skippedProtected: number;
};

export async function preloadExistingSpawnIds(targetShard: string, spawnIds: string[]): Promise<Set<string>> {
  const client = await db.connect();
  try {
    const q = await client.query(
      `SELECT spawn_id FROM spawn_points WHERE shard_id = $1 AND spawn_id = ANY($2::text[])`,
      [targetShard, spawnIds],
    );
    return new Set<string>((q.rows as any[]).map((r) => String(r.spawn_id)).filter(Boolean));
  } finally {
    client.release();
  }
}

export async function preloadProtectedSpawnMap(args: {
  targetShard: string;
  spawnIds: string[];
  updateExisting: boolean;
  allowProtected: boolean;
}): Promise<Map<string, ProtectedRestoreMeta>> {
  const out = new Map<string, ProtectedRestoreMeta>();
  if (!args.updateExisting || args.allowProtected || args.spawnIds.length === 0) return out;

  const client = await db.connect();
  try {
    const q = await client.query(
      `SELECT spawn_id, owner_kind, is_locked
       FROM spawn_points
       WHERE shard_id = $1
         AND spawn_id = ANY($2::text[])
         AND (is_locked = TRUE OR owner_kind = 'editor')`,
      [args.targetShard, args.spawnIds],
    );
    for (const row of q.rows as any[]) {
      out.set(String(row.spawn_id), {
        ownerKind: typeof row.owner_kind === "string" ? row.owner_kind : null,
        isLocked: Boolean(row.is_locked),
      });
    }
    return out;
  } finally {
    client.release();
  }
}

export async function computeRestoreExtraTargetDiff(args: {
  targetShard: string;
  snapshotBounds?: CellBounds | null;
  snapshotCellSize?: number | null;
  snapshotPad?: number | null;
  snapshotTypes?: string[] | null;
  spawnIds: string[];
  limit?: number;
}): Promise<{ extraTargetIds: string[]; extraTargetCount?: number }> {
  const {
    targetShard,
    snapshotBounds,
    snapshotCellSize,
    snapshotPad,
    snapshotTypes,
    spawnIds,
    limit = 75,
  } = args;

  const haveSliceMeta =
    !!snapshotBounds &&
    Number.isFinite(Number(snapshotCellSize)) &&
    Number.isFinite(Number(snapshotPad)) &&
    Array.isArray(snapshotTypes) &&
    snapshotTypes.length > 0;

  if (!haveSliceMeta) return { extraTargetIds: [] };

  const cellSize = Math.max(1, Math.floor(Number(snapshotCellSize)));
  const pad = Math.max(0, Math.floor(Number(snapshotPad)));
  const minX = snapshotBounds.minCx * cellSize - pad;
  const maxX = (snapshotBounds.maxCx + 1) * cellSize + pad;
  const minZ = snapshotBounds.minCz * cellSize - pad;
  const maxZ = (snapshotBounds.maxCz + 1) * cellSize + pad;
  const snapshotIdSet = new Set<string>(spawnIds);

  const client = await db.connect();
  try {
    const q = await client.query(
      `SELECT spawn_id
       FROM spawn_points
       WHERE shard_id = $1
         AND type = ANY($2::text[])
         AND x >= $3 AND x <= $4
         AND z >= $5 AND z <= $6
       ORDER BY spawn_id`,
      [targetShard, snapshotTypes, minX, maxX, minZ, maxZ],
    );

    let count = 0;
    const list: string[] = [];
    for (const row of q.rows as any[]) {
      const sid = String(row.spawn_id ?? "");
      if (!sid || snapshotIdSet.has(sid)) continue;
      count += 1;
      if (list.length < limit) list.push(sid);
    }

    return { extraTargetIds: list, extraTargetCount: count };
  } finally {
    client.release();
  }
}

export function planRestoreSnapshot(args: {
  spawns: SnapshotSpawnRow[];
  existingSet: Set<string>;
  protectedMap: Map<string, ProtectedRestoreMeta>;
  updateExisting: boolean;
  allowBrainOwned: boolean;
  allowProtected: boolean;
  extraTargetIds?: string[];
  extraTargetCount?: number;
  limit?: number;
}): RestoreSnapshotPlan {
  const insertIds: string[] = [];
  const updateIds: string[] = [];
  const protectedUpdateIds: string[] = [];
  const skipIds: string[] = [];
  const readOnlyIds: string[] = [];

  for (const spawn of args.spawns) {
    const sid = String(spawn.spawnId ?? "");
    if (!sid) continue;

    if (!args.allowBrainOwned && !isSpawnEditable(sid)) {
      readOnlyIds.push(sid);
      continue;
    }

    if (!args.existingSet.has(sid)) {
      insertIds.push(sid);
      continue;
    }

    if (!args.updateExisting) {
      skipIds.push(sid);
      continue;
    }

    updateIds.push(sid);
    if (!args.allowProtected && args.protectedMap.has(sid)) protectedUpdateIds.push(sid);
  }

  const explain = makeReasonMaps();
  for (const sid of readOnlyIds) {
    addReasonExplainStep(explain, sid, readOnlyReason(sid), "spawn is not editable in this mode", { spawnId: sid });

    const meta = args.protectedMap.get(sid);
    if (meta && (meta.ownerKind === "editor" || meta.isLocked)) {
      addReasonExplainStep(
        explain,
        sid,
        protectedReason(meta.ownerKind, meta.isLocked),
        "row is also protected (locked or editor-owned)",
        { spawnId: sid, ownerKind: meta.ownerKind, isLocked: meta.isLocked },
      );
    }
  }

  for (const sid of protectedUpdateIds) {
    const meta = args.protectedMap.get(sid);
    addReasonExplainStep(
      explain,
      sid,
      protectedReason(meta?.ownerKind, meta?.isLocked),
      "existing row is protected (locked or editor-owned)",
      { spawnId: sid, ownerKind: meta?.ownerKind ?? null, isLocked: Boolean(meta?.isLocked) },
    );
  }

  const opsPreview = buildSpawnSliceOpsPreview({
    insertIds,
    updateIds,
    skipIds,
    readOnlyIds,
    extraTargetIds: args.extraTargetIds,
    extraTargetCount: args.extraTargetCount,
    limit: args.limit ?? 75,
  });

  (opsPreview as any).reasons = explain.reasons;
  (opsPreview as any).reasonCounts = explain.reasonCounts;
  (opsPreview as any).reasonDetails = explain.reasonDetails;
  (opsPreview as any).reasonChains = explain.reasonChains;

  if (protectedUpdateIds.length > 0) {
    (opsPreview as any).protectedUpdateSpawnIds = protectedUpdateIds.slice(0, args.limit ?? 75);
    (opsPreview as any).skippedProtected = protectedUpdateIds.length;
  }

  return {
    insertIds,
    updateIds,
    protectedUpdateIds,
    skipIds,
    readOnlyIds,
    extraTargetIds: args.extraTargetIds ?? [],
    extraTargetCount: args.extraTargetCount,
    opsPreview,
  };
}

export async function applyRestoreSnapshot(args: {
  targetShard: string;
  spawns: SnapshotSpawnRow[];
  existingSet: Set<string>;
  protectedMap: Map<string, ProtectedRestoreMeta>;
  updateExisting: boolean;
  allowBrainOwned: boolean;
  allowProtected: boolean;
  commit: boolean;
}): Promise<RestoreSnapshotCounts> {
  const txn = await db.connect();
  const counts: RestoreSnapshotCounts = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    skippedReadOnly: 0,
    skippedProtected: 0,
  };

  try {
    await txn.query("BEGIN");

    for (const spawn of args.spawns) {
      const sid = String(spawn.spawnId ?? "");
      if (!sid) continue;

      if (!args.allowBrainOwned && !isSpawnEditable(sid)) {
        counts.skippedReadOnly += 1;
        continue;
      }

      const exists = args.existingSet.has(sid);
      const protoId = String(spawn.protoId ?? sid);
      const archetype = String(spawn.archetype ?? "");
      const type = String(spawn.type ?? "");
      const variantId = spawn.variantId == null ? null : String(spawn.variantId);
      const x = Number.isFinite(spawn.x) ? Number(spawn.x) : 0;
      const y = Number.isFinite(spawn.y) ? Number(spawn.y) : 0;
      const z = Number.isFinite(spawn.z) ? Number(spawn.z) : 0;
      const regionId = String(spawn.regionId ?? "");
      const townTier = spawn.townTier == null || !Number.isFinite(Number(spawn.townTier)) ? null : Number(spawn.townTier);

      if (!exists) {
        await txn.query(
          `INSERT INTO spawn_points (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [args.targetShard, sid, type, archetype, protoId, variantId, x, y, z, regionId, townTier],
        );
        counts.inserted += 1;
        continue;
      }

      if (!args.updateExisting) {
        counts.skipped += 1;
        continue;
      }

      if (!args.allowProtected && args.protectedMap.has(sid)) {
        counts.skippedProtected += 1;
        continue;
      }

      await txn.query(
        `UPDATE spawn_points
         SET type=$3, archetype=$4, proto_id=$5, variant_id=$6, x=$7, y=$8, z=$9, region_id=$10, town_tier=$11
         WHERE shard_id=$1 AND spawn_id=$2`,
        [args.targetShard, sid, type, archetype, protoId, variantId, x, y, z, regionId, townTier],
      );
      counts.updated += 1;
    }

    await txn.query(args.commit ? "COMMIT" : "ROLLBACK");
    return counts;
  } catch (error) {
    try {
      await txn.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    txn.release();
  }
}
