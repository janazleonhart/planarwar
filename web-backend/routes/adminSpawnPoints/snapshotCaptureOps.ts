//web-backend/routes/adminSpawnPoints/snapshotCaptureOps.ts

import type { Pool } from "pg";
import {
  makeSnapshotId,
  safeSnapshotName,
  type SnapshotSpawnRow,
  type SpawnSliceSnapshot,
  type StoredSpawnSnapshotDoc,
} from "./snapshotStore";
import { parseCellBounds } from "./opsPreview";

export async function computeSpawnSliceSnapshot(args: {
  db: Pool;
  shardId: string;
  boundsRaw: string;
  cellSize: number;
  pad: number;
  types: string[];
}): Promise<{ snapshot: SpawnSliceSnapshot; filename: string }> {
  const shardId = args.shardId.trim() || "prime_shard";
  const bounds = parseCellBounds(args.boundsRaw);

  const cellSize = Math.max(1, Math.floor(Number(args.cellSize || 512)));
  const pad = Math.max(0, Math.floor(Number(args.pad || 0)));

  const minX = bounds.minCx * cellSize - pad;
  const maxX = (bounds.maxCx + 1) * cellSize + pad;
  const minZ = bounds.minCz * cellSize - pad;
  const maxZ = (bounds.maxCz + 1) * cellSize + pad;

  type Row = {
    shard_id: string;
    spawn_id: string;
    type: string;
    proto_id: string | null;
    archetype: string;
    variant_id: string | null;
    x: number | null;
    y: number | null;
    z: number | null;
    region_id: string | null;
    town_tier: number | null;
  };

  const client = await args.db.connect();
  let rows: Row[] = [];
  try {
    const q = await client.query(
      `
        SELECT shard_id, spawn_id, type, proto_id, archetype, variant_id, x, y, z, region_id, town_tier
        FROM spawn_points
        WHERE shard_id = $1
          AND type = ANY($2::text[])
          AND x >= $3 AND x <= $4
          AND z >= $5 AND z <= $6
        ORDER BY type, spawn_id
      `,
      [shardId, args.types, minX, maxX, minZ, maxZ],
    );
    rows = q.rows as Row[];
  } finally {
    client.release();
  }

  const spawns: SnapshotSpawnRow[] = rows.map((r) => ({
    shardId: String(r.shard_id),
    spawnId: String(r.spawn_id),
    type: String(r.type),
    protoId: String(r.proto_id ?? r.spawn_id),
    archetype: String(r.archetype),
    variantId: r.variant_id == null ? null : String(r.variant_id),
    x: r.x == null ? 0 : Number(r.x),
    y: r.y == null ? 0 : Number(r.y),
    z: r.z == null ? 0 : Number(r.z),
    regionId: String(r.region_id ?? ""),
    townTier: r.town_tier == null ? null : Number(r.town_tier),
  }));

  const snapshot: SpawnSliceSnapshot = {
    kind: "admin.snapshot-spawns",
    version: 1,
    createdAt: new Date().toISOString(),
    shardId,
    bounds,
    cellSize,
    pad,
    types: [...args.types],
    rows: spawns.length,
    spawns,
  };

  const safeBounds = `${bounds.minCx}..${bounds.maxCx},${bounds.minCz}..${bounds.maxCz}`;
  const filename = `snapshot_${new Date().toISOString().replace(/[:.]/g, "-")}_${shardId}_${safeBounds}.json`;

  return { snapshot, filename };
}

export function buildStoredSnapshotDoc(args: {
  nameRaw: string;
  shardId: string;
  snapshot: SpawnSliceSnapshot;
  tags: string[];
  notes: string | null;
  savedAt?: string;
}): StoredSpawnSnapshotDoc {
  const name = safeSnapshotName(args.nameRaw);
  const savedAt = args.savedAt ?? new Date().toISOString();
  return {
    kind: "admin.stored-spawn-snapshot",
    version: 3,
    id: makeSnapshotId(name, args.shardId, args.snapshot.bounds, args.snapshot.types),
    name,
    savedAt,
    tags: args.tags,
    notes: args.notes,
    isArchived: false,
    isPinned: false,
    expiresAt: null,
    snapshot: args.snapshot,
  };
}
