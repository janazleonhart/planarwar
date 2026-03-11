//web-backend/routes/adminSpawnPoints/opsPreview.ts

import type { CellBounds, StoredSpawnSnapshotMeta } from "./snapshotStore";
export type { CellBounds } from "./snapshotStore";

export type AdminSummary = {
  total: number;
  byType?: Record<string, number>;
  byProtoId?: Record<string, number>;
};

export type SpawnSliceOpsPreview = {
  limit: number;
  truncated: boolean;
  insertSpawnIds: string[];
  insertCount: number;
  updateSpawnIds: string[];
  updateCount: number;
  skipSpawnIds: string[];
  skipCount: number;
  readOnlySpawnIds: string[];
  readOnlyCount: number;
  extraTargetSpawnIds?: string[];
  extraTargetCount?: number;
  protectedUpdateSpawnIds?: string[];
  skippedProtected?: number;
};

export type ReasonCode = "read_only" | "protected_locked" | "protected_editor_owned" | "protected";

export type ReasonDetail = {
  code: ReasonCode;
  message: string;
  spawnId?: string;
  ownerKind?: string | null;
  isLocked?: boolean;
};

export type ReasonMaps = {
  reasons: Record<string, string>;
  reasonCounts: Record<string, number>;
  reasonDetails: Record<string, ReasonDetail>;
  reasonChains: Record<string, ReasonDetail[]>;
};

export type DuplicateSnapshotResponse =
  | { kind: "spawn_points.snapshots.duplicate"; ok: true; snapshot: StoredSpawnSnapshotMeta }
  | { kind: "spawn_points.snapshots.duplicate"; ok: false; error: string };

export type WorldBox = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type MotherBrainListRow = {
  spawnId: string;
  type: string;
  protoId: string | null;
  regionId: string | null;
  protected?: boolean;
};

export type MotherBrainOpsPreview = {
  limit: number;
  truncated: boolean;
  deleteSpawnIds?: string[];
  insertSpawnIds?: string[];
  updateSpawnIds?: string[];
  skipSpawnIds?: string[];
  duplicatePlannedSpawnIds?: string[];
  droppedPlannedSpawnIds?: string[];
  protectedDeleteSpawnIds?: string[];
  protectedUpdateSpawnIds?: string[];
  reasons?: Record<string, string>;
  reasonCounts?: Record<string, number>;
  reasonDetails?: Record<string, ReasonDetail>;
  reasonChains?: Record<string, ReasonDetail[]>;
};

export type TownBaselineOpsPreview = {
  limit: number;
  truncated: boolean;
  insertSpawnIds?: string[];
  updateSpawnIds?: string[];
  skipSpawnIds?: string[];
  readOnlySpawnIds?: string[];
  protectedUpdateSpawnIds?: string[];
};

export type MotherBrainStatusResponse = {
  kind?: string;
  summary?: AdminSummary;
  ok: boolean;
  shardId: string;
  bounds: string;
  cellSize: number;
  theme: string | null;
  epoch: number | null;
  total: number;
  box: WorldBox;
  byTheme: Record<string, number>;
  byEpoch: Record<string, number>;
  byType: Record<string, number>;
  topProto: Record<string, number>;
  list?: MotherBrainListRow[];
};

export type MotherBrainWaveBudgetConfig = {
  maxTotalInBounds?: number | null;
  maxThemeInBounds?: number | null;
  maxEpochThemeInBounds?: number | null;
  maxNewInserts?: number | null;
};

export type MotherBrainWaveRequest = {
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin?: number;
  placeInset?: number;
  seed: string;
  epoch: number;
  theme: string;
  count: number;
  append?: boolean;
  updateExisting?: boolean;
  budget?: MotherBrainWaveBudgetConfig;
  commit?: boolean;
  confirm?: string;
};

export type MotherBrainWaveResponse = {
  kind?: string;
  summary?: AdminSummary;
  ok: boolean;
  shardId?: string;
  bounds?: string;
  cellSize?: number;
  borderMargin?: number;
  wouldDelete?: number;
  wouldInsert?: number;
  wouldUpdate?: number;
  wouldSkip?: number;
  duplicatePlanned?: number;
  droppedDueToBudget?: number;
  deleted?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  theme?: string;
  epoch?: number;
  append?: boolean;
  budget?: MotherBrainWaveBudgetConfig;
  budgetReport?: any;
  budgetFilter?: any;
  applyPlan?: any;
  opsPreview?: MotherBrainOpsPreview;
  expectedConfirmToken?: string;
  error?: string;
};

export type MotherBrainWipeRequest = {
  shardId?: string;
  bounds: string;
  cellSize?: number;
  borderMargin?: number;
  theme?: string | null;
  epoch?: number | null;
  commit?: boolean;
  confirm?: string;
  list?: boolean;
  limit?: number;
};

export type MotherBrainWipeResponse = {
  kind?: string;
  summary?: AdminSummary;
  ok: boolean;
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin: number;
  theme: string | null;
  epoch: number | null;
  commit: boolean;
  wouldDelete?: number;
  deleted?: number;
  list?: MotherBrainListRow[];
  opsPreview?: MotherBrainOpsPreview;
  expectedConfirmToken?: string;
  error?: string;
};

export type TownBaselinePreviewItem = {
  op: "insert" | "update" | "skip";
  spawn?: { spawnId?: string | null; ownerKind?: string | null; isLocked?: boolean | null } | null;
};

export function makeReasonMaps(): ReasonMaps {
  return { reasons: {}, reasonCounts: {}, reasonDetails: {}, reasonChains: {} };
}

export function readOnlyReason(_spawnId: string): ReasonCode {
  return "read_only";
}

export function protectedReason(ownerKind?: string | null, isLocked?: boolean | null): ReasonCode {
  if (Boolean(isLocked)) return "protected_locked";
  if (String(ownerKind ?? "").trim().toLowerCase() === "editor") return "protected_editor_owned";
  return "protected";
}

function reasonMessage(code: ReasonCode): string {
  switch (code) {
    case "read_only":
      return "spawn is not editable in this mode";
    case "protected_locked":
      return "row is locked";
    case "protected_editor_owned":
      return "row is editor-owned";
    default:
      return "row is protected by ownership/lock rules";
  }
}

export function addReasonExplainStep(
  explain: ReasonMaps,
  spawnId: string,
  code: ReasonCode,
  fallbackMessage: string,
  detail?: Partial<ReasonDetail>,
): void {
  const sid = String(spawnId ?? "").trim();
  if (!sid) return;

  const full: ReasonDetail = {
    code,
    message: String(fallbackMessage || reasonMessage(code)),
    ...(detail ?? {}),
    spawnId: sid,
  };

  explain.reasons[sid] = full.message;
  explain.reasonCounts[code] = (explain.reasonCounts[code] ?? 0) + 1;
  explain.reasonDetails[sid] = full;
  const chain = explain.reasonChains[sid] ?? [];
  chain.push(full);
  explain.reasonChains[sid] = chain;
}

export function makeProtectedReasonFromRow(row: unknown): ReasonCode {
  const r = row as { owner_kind?: unknown; is_locked?: unknown };
  return protectedReason(
    r?.owner_kind == null ? null : String(r.owner_kind),
    Boolean(r?.is_locked),
  );
}

export function summarizePlannedSpawns(
  spawns: Array<{ type?: string | null; protoId?: string | null }>,
): AdminSummary {
  const byType: Record<string, number> = {};
  const byProtoId: Record<string, number> = {};
  for (const s of spawns) {
    const t = String(s.type ?? "(unknown)");
    const p = String(s.protoId ?? "(none)");
    byType[t] = (byType[t] ?? 0) + 1;
    byProtoId[p] = (byProtoId[p] ?? 0) + 1;
  }
  const total = spawns.length;
  return {
    total,
    ...(total > 0 ? { byType, byProtoId } : null),
  } as AdminSummary;
}

export function buildTownBaselineOpsPreview(
  planItems: TownBaselinePreviewItem[],
  isSpawnEditable: (spawnId: string) => boolean,
  limit = 75,
): TownBaselineOpsPreview {
  const inserts: string[] = [];
  const updates: string[] = [];
  const protectedUpdates: string[] = [];
  const skips: string[] = [];
  const readOnly: string[] = [];

  for (const item of planItems) {
    const sid = String(item?.spawn?.spawnId ?? "").trim();
    if (!sid) continue;

    if (!isSpawnEditable(sid)) {
      readOnly.push(sid);
      continue;
    }

    if (item.op === "insert") inserts.push(sid);
    else if (item.op === "update") {
      updates.push(sid);
      const ok = !(item.spawn?.ownerKind === "editor" || Boolean(item.spawn?.isLocked));
      if (!ok) protectedUpdates.push(sid);
    } else skips.push(sid);
  }

  const sort = (arr: string[]) => arr.sort((a, b) => a.localeCompare(b));
  sort(inserts);
  sort(updates);
  sort(protectedUpdates);
  sort(skips);
  sort(readOnly);

  const truncated =
    inserts.length > limit ||
    updates.length > limit ||
    protectedUpdates.length > limit ||
    skips.length > limit ||
    readOnly.length > limit;

  return {
    limit,
    truncated,
    insertSpawnIds: inserts.slice(0, limit),
    updateSpawnIds: updates.slice(0, limit),
    protectedUpdateSpawnIds: protectedUpdates.length ? protectedUpdates.slice(0, limit) : undefined,
    skipSpawnIds: skips.slice(0, limit),
    readOnlySpawnIds: readOnly.slice(0, limit),
  };
}

export function buildSpawnSliceOpsPreview(args: {
  insertIds: string[];
  updateIds: string[];
  skipIds: string[];
  readOnlyIds: string[];
  extraTargetIds?: string[];
  extraTargetCount?: number;
  limit?: number;
}): SpawnSliceOpsPreview {
  const limit = Math.max(1, Math.floor(args.limit ?? 75));

  const sort = (arr: string[]) => arr.sort((a, b) => a.localeCompare(b));

  const insAll = [...args.insertIds];
  const updAll = [...args.updateIds];
  const skpAll = [...args.skipIds];
  const roAll = [...args.readOnlyIds];
  const extraAll = Array.isArray(args.extraTargetIds) ? [...args.extraTargetIds] : [];

  sort(insAll);
  sort(updAll);
  sort(skpAll);
  sort(roAll);
  sort(extraAll);

  const insertCount = insAll.length;
  const updateCount = updAll.length;
  const skipCount = skpAll.length;
  const readOnlyCount = roAll.length;

  const extraTargetCount =
    Number.isFinite(Number(args.extraTargetCount)) ? Number(args.extraTargetCount) : extraAll.length;

  const truncated =
    insertCount > limit ||
    updateCount > limit ||
    skipCount > limit ||
    readOnlyCount > limit ||
    extraTargetCount > limit;

  return {
    limit,
    truncated,
    insertSpawnIds: insAll.slice(0, limit),
    insertCount,
    updateSpawnIds: updAll.slice(0, limit),
    updateCount,
    skipSpawnIds: skpAll.slice(0, limit),
    skipCount,
    readOnlySpawnIds: roAll.slice(0, limit),
    readOnlyCount,
    extraTargetSpawnIds: extraAll.length ? extraAll.slice(0, limit) : undefined,
    extraTargetCount: extraTargetCount ? extraTargetCount : undefined,
  };
}

export function parseCellBounds(bounds: string): CellBounds {
  const parts = String(bounds ?? "").trim().split(",");
  if (parts.length !== 2) {
    throw new Error("bounds must be like -1..1,-1..1");
  }

  const parseRange = (txt: string) => {
    const m = txt.trim().match(/^(-?\d+)\.\.(-?\d+)$/);
    if (!m) throw new Error("bounds range must be like -1..1");
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("bounds range must be numbers");
    return a <= b ? { min: a, max: b } : { min: b, max: a };
  };

  const xr = parseRange(parts[0]);
  const zr = parseRange(parts[1]);
  return { minCx: xr.min, maxCx: xr.max, minCz: zr.min, maxCz: zr.max };
}

export function toWorldBox(cellBounds: CellBounds, cellSize: number, borderMargin: number): WorldBox {
  const minX = (cellBounds.minCx - borderMargin) * cellSize;
  const maxX = (cellBounds.maxCx + 1 + borderMargin) * cellSize;
  const minZ = (cellBounds.minCz - borderMargin) * cellSize;
  const maxZ = (cellBounds.maxCz + 1 + borderMargin) * cellSize;
  return { minX, maxX, minZ, maxZ };
}
