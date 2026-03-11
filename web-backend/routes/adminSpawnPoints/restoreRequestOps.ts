//web-backend/routes/adminSpawnPoints/restoreRequestOps.ts

import { createHash } from "crypto";
import {
  coerceSnapshotSpawns,
  type CellBounds,
  type SnapshotSpawnRow,
} from "./snapshotStore";
import type { SpawnSliceOpsPreview } from "./opsPreview";

export type ParsedRestoreRequest = {
  snapshotShard: string;
  snapshotBounds: CellBounds | null;
  snapshotCellSize: number | null;
  snapshotPad: number | null;
  snapshotTypes: string[] | null;
  spawns: SnapshotSpawnRow[];
  targetShard: string;
  updateExisting: boolean;
  allowBrainOwned: boolean;
  allowProtected: boolean;
  commit: boolean;
  confirm: string | null;
  confirmPhrase: string | null;
};

export type RestoreConfirmRequirements = {
  expectedConfirmToken: string | null;
  expectedConfirmPhrase: string | null;
  crossShard: boolean;
};

type RestoreConfirmResponseArgs = {
  expectedConfirmToken: string | null;
  expectedConfirmPhrase: string | null;
  opsPreview: SpawnSliceOpsPreview;
  snapshotShard: string;
  targetShard: string;
  rows: number;
  snapshotBounds: CellBounds | null;
  snapshotCellSize: number | null;
  snapshotPad: number | null;
  snapshotTypes: string[] | null;
  crossShard: boolean;
  allowBrainOwned: boolean;
  allowProtected: boolean;
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  wouldReadOnly: number;
};

function hashToken(input: unknown): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return createHash("sha256").update(s).digest("hex").slice(0, 10);
}

export function makeConfirmToken(prefix: "WIPE" | "REPLACE", shardId: string, scope: unknown): string {
  return `${prefix}:${shardId}:${hashToken(scope)}`;
}

export function parseRestoreRequest(body: any): ParsedRestoreRequest {
  const snapshotRaw = body?.snapshot ?? body;
  const snapshotObj = typeof snapshotRaw === "string" ? JSON.parse(snapshotRaw) : snapshotRaw;

  const {
    snapshotShard,
    bounds: snapshotBounds,
    cellSize: snapshotCellSize,
    pad: snapshotPad,
    types: snapshotTypes,
    spawns,
  } = coerceSnapshotSpawns(snapshotObj);

  const targetShard = String(body?.targetShard ?? snapshotShard ?? "prime_shard").trim() || "prime_shard";

  return {
    snapshotShard,
    snapshotBounds,
    snapshotCellSize,
    snapshotPad,
    snapshotTypes,
    spawns,
    targetShard,
    updateExisting: Boolean(body?.updateExisting),
    allowBrainOwned: Boolean(body?.allowBrainOwned),
    allowProtected: Boolean(body?.allowProtected),
    commit: Boolean(body?.commit),
    confirm: String(body?.confirm ?? "").trim() || null,
    confirmPhrase: String(body?.confirmPhrase ?? "").trim() || null,
  };
}

export function buildRestoreConfirmRequirements(args: {
  commit: boolean;
  targetShard: string;
  snapshotShard: string;
  allowBrainOwned: boolean;
  allowProtected: boolean;
  updateExisting: boolean;
  updateIds: string[];
  rowCount: number;
}): RestoreConfirmRequirements {
  const crossShard = args.targetShard !== args.snapshotShard;
  const expectedConfirmToken =
    args.updateExisting && args.updateIds.length > 0
      ? makeConfirmToken("REPLACE", args.targetShard, {
          op: "restore",
          updateIds: args.updateIds,
          rows: args.rowCount,
        })
      : null;

  const expectedConfirmPhrase =
    args.commit && (crossShard || args.allowBrainOwned || args.allowProtected) ? "RESTORE" : null;

  return {
    expectedConfirmToken,
    expectedConfirmPhrase,
    crossShard,
  };
}

export function buildRestoreConfirmPhraseError(args: RestoreConfirmResponseArgs) {
  return {
    kind: "spawn_points.restore",
    ok: false,
    error: "confirm_phrase_required",
    expectedConfirmPhrase: args.expectedConfirmPhrase ?? undefined,
    expectedConfirmToken: args.expectedConfirmToken ?? undefined,
    opsPreview: args.opsPreview,
    snapshotShard: args.snapshotShard,
    targetShard: args.targetShard,
    rows: args.rows,
    snapshotBounds: args.snapshotBounds ?? undefined,
    snapshotCellSize: args.snapshotCellSize ?? undefined,
    snapshotPad: args.snapshotPad ?? undefined,
    snapshotTypes: args.snapshotTypes ?? undefined,
    crossShard: args.crossShard,
    allowBrainOwned: args.allowBrainOwned,
    allowProtected: args.allowProtected,
    wouldInsert: args.wouldInsert,
    wouldUpdate: args.wouldUpdate,
    wouldSkip: args.wouldSkip,
    wouldReadOnly: args.wouldReadOnly,
  };
}

export function buildRestoreConfirmTokenError(args: RestoreConfirmResponseArgs) {
  return {
    kind: "spawn_points.restore",
    ok: false,
    error: "confirm_required",
    expectedConfirmToken: args.expectedConfirmToken ?? undefined,
    expectedConfirmPhrase: args.expectedConfirmPhrase ?? undefined,
    opsPreview: args.opsPreview,
    snapshotShard: args.snapshotShard,
    targetShard: args.targetShard,
    rows: args.rows,
    snapshotBounds: args.snapshotBounds ?? undefined,
    snapshotCellSize: args.snapshotCellSize ?? undefined,
    snapshotPad: args.snapshotPad ?? undefined,
    snapshotTypes: args.snapshotTypes ?? undefined,
    crossShard: args.crossShard,
    allowBrainOwned: args.allowBrainOwned,
    allowProtected: args.allowProtected,
    wouldInsert: args.wouldInsert,
    wouldUpdate: args.wouldUpdate,
    wouldSkip: args.wouldSkip,
    wouldReadOnly: args.wouldReadOnly,
  };
}
