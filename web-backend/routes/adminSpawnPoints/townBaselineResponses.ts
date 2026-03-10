//web-backend/routes/adminSpawnPoints/townBaselineResponses.ts

import {
  buildTownBaselineOpsPreview,
  summarizePlannedSpawns,
  type AdminSummary,
  type TownBaselineOpsPreview,
} from "./opsPreview";

export type TownBaselineResponsePlanItem = {
  spawn: {
    id?: number | null;
    shardId: string;
    spawnId: string;
    type: string;
    archetype: string;
    protoId?: string | null;
    variantId?: string | null;
    x?: number | null;
    y?: number | null;
    z?: number | null;
    regionId?: string | null;
    townTier?: number | null;
    ownerKind?: "brain" | "baseline" | "editor" | "system" | null;
    ownerId?: string | null;
    isLocked?: boolean | null;
    authority?: "anchor" | "seed" | "brain" | "manual" | null;
  };
  op: "insert" | "update" | "skip";
  existingId?: number | null;
};

export type TownBaselineResponsePlan = {
  shardId: string;
  bounds: string;
  cellSize: number;
  seedBase: string;
  spawnIdMode: "seed" | "legacy";
  includeStations: boolean;
  respectTownTierStations: boolean;
  townTierOverride: number | null;
  planItems: TownBaselineResponsePlanItem[];
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  skippedProtected?: number;
};

export type TownBaselineSuccessResponse<K extends "town_baseline.plan" | "town_baseline.apply" = "town_baseline.plan" | "town_baseline.apply"> = {
  kind?: K;
  summary?: AdminSummary;
  ok: true;
  shardId: string;
  bounds: string;
  cellSize: number;
  seedBase: string;
  spawnIdMode: "seed" | "legacy";
  includeStations: boolean;
  respectTownTierStations: boolean;
  townTierOverride: number | null;
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  skippedReadOnly?: number;
  skippedProtected?: number;
  opsPreview: TownBaselineOpsPreview;
  plan: TownBaselineResponsePlanItem[];
};

export type TownBaselineErrorResponse = {
  ok: false;
  shardId: string;
  bounds: string;
  cellSize: number;
  seedBase: string;
  spawnIdMode: "seed" | "legacy";
  includeStations: boolean;
  respectTownTierStations: boolean;
  townTierOverride: number | null;
  error: string;
};

export function buildTownBaselineSuccessResponse<K extends "town_baseline.plan" | "town_baseline.apply">(args: {
  kind: K;
  plan: TownBaselineResponsePlan;
  isSpawnEditable: (spawnId: string) => boolean;
  counts?: {
    wouldInsert: number;
    wouldUpdate: number;
    wouldSkip: number;
    skippedReadOnly?: number;
    skippedProtected?: number;
  };
}): TownBaselineSuccessResponse<K> {
  const plannedSpawns = args.plan.planItems.map((item) => item.spawn);
  return {
    kind: args.kind,
    summary: summarizePlannedSpawns(plannedSpawns),
    ok: true,
    shardId: args.plan.shardId,
    bounds: args.plan.bounds,
    cellSize: args.plan.cellSize,
    seedBase: args.plan.seedBase,
    spawnIdMode: args.plan.spawnIdMode,
    includeStations: args.plan.includeStations,
    respectTownTierStations: args.plan.respectTownTierStations,
    townTierOverride: args.plan.townTierOverride,
    wouldInsert: args.counts?.wouldInsert ?? args.plan.wouldInsert,
    wouldUpdate: args.counts?.wouldUpdate ?? args.plan.wouldUpdate,
    wouldSkip: args.counts?.wouldSkip ?? args.plan.wouldSkip,
    ...(args.counts?.skippedReadOnly != null ? { skippedReadOnly: args.counts.skippedReadOnly } : null),
    skippedProtected: args.counts?.skippedProtected ?? args.plan.skippedProtected ?? 0,
    opsPreview: buildTownBaselineOpsPreview(args.plan.planItems, args.isSpawnEditable),
    plan: args.plan.planItems,
  };
}

export function buildTownBaselineErrorResponse(args: {
  shardId: string;
  bounds: string;
  cellSize: number;
  seedBase: string;
  spawnIdMode: "seed" | "legacy";
  includeStations: boolean;
  respectTownTierStations: boolean;
  townTierOverride: number | null;
  error: string;
}): TownBaselineErrorResponse {
  return {
    ok: false,
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize: args.cellSize,
    seedBase: args.seedBase,
    spawnIdMode: args.spawnIdMode,
    includeStations: args.includeStations,
    respectTownTierStations: args.respectTownTierStations,
    townTierOverride: args.townTierOverride,
    error: args.error,
  };
}
