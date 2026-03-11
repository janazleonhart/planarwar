//web-backend/routes/adminSpawnPoints/motherBrainResponses.ts

import type {
  MotherBrainListRow,
  MotherBrainOpsPreview,
  MotherBrainWaveBudgetConfig,
  MotherBrainWaveResponse,
  MotherBrainWipeResponse,
} from "./opsPreview";

export function buildMotherBrainWaveConfirmRequiredResponse(args: {
  expectedConfirmToken: string;
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin: number;
  theme: string;
  epoch: number;
  append: boolean;
  wouldDelete: number;
  existingBrainSpawnIds: string[];
}): MotherBrainWaveResponse {
  const { expectedConfirmToken, shardId, bounds, cellSize, borderMargin, theme, epoch, append, wouldDelete, existingBrainSpawnIds } = args;
  return {
    kind: "mother_brain.wave",
    ok: false,
    error: "confirm_required",
    expectedConfirmToken,
    shardId,
    bounds,
    cellSize,
    borderMargin,
    theme,
    epoch,
    append,
    wouldDelete,
    opsPreview: {
      limit: 75,
      truncated: existingBrainSpawnIds.length > 75,
      deleteSpawnIds: [...existingBrainSpawnIds]
        .map((s: unknown) => String(s ?? ""))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 75),
    },
  };
}

export function buildMotherBrainWaveResponse(args: {
  commit: boolean;
  append: boolean;
  theme: string;
  epoch: number;
  expectedConfirmToken: string | null;
  budget: MotherBrainWaveBudgetConfig;
  budgetReport: any;
  budgetFilter: any;
  applyPlan: any;
  opsPreview: MotherBrainOpsPreview;
  wouldDelete: number;
  deleted: number;
  inserted: number;
  updated: number;
  skipped: number;
}): MotherBrainWaveResponse {
  const {
    commit,
    append,
    theme,
    epoch,
    expectedConfirmToken,
    budget,
    budgetReport,
    budgetFilter,
    applyPlan,
    opsPreview,
    wouldDelete,
    deleted,
    inserted,
    updated,
    skipped,
  } = args;

  if (commit) {
    return {
      kind: "mother_brain.wave",
      summary: { total: inserted + updated + deleted },
      ok: true,
      deleted,
      inserted,
      updated,
      skipped,
      theme,
      epoch,
      append,
      expectedConfirmToken: expectedConfirmToken ?? undefined,
      budget,
      budgetReport,
      budgetFilter,
      applyPlan,
      opsPreview,
    };
  }

  return {
    kind: "mother_brain.wave",
    summary: { total: wouldDelete + applyPlan.wouldInsert + applyPlan.wouldUpdate },
    ok: true,
    wouldDelete,
    wouldInsert: applyPlan.wouldInsert,
    wouldUpdate: applyPlan.wouldUpdate,
    wouldSkip: applyPlan.wouldSkip,
    duplicatePlanned: applyPlan.duplicatePlanned,
    droppedDueToBudget: budgetFilter.droppedDueToBudget,
    theme,
    epoch,
    append,
    expectedConfirmToken: expectedConfirmToken ?? undefined,
    budget,
    budgetReport,
    budgetFilter,
    applyPlan,
    opsPreview,
  };
}

export function buildMotherBrainWipeResponse(args: {
  commit: boolean;
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin: number;
  theme: string | null;
  epoch: number | null;
  deleted: number;
  wouldDelete: number;
  opsPreview: MotherBrainOpsPreview;
  expectedConfirmToken: string | null;
  wantList: boolean;
  listRows?: MotherBrainListRow[];
}): MotherBrainWipeResponse {
  const {
    commit,
    shardId,
    bounds,
    cellSize,
    borderMargin,
    theme,
    epoch,
    deleted,
    wouldDelete,
    opsPreview,
    expectedConfirmToken,
    wantList,
    listRows,
  } = args;

  return commit
    ? {
        kind: "mother_brain.wipe",
        summary: { total: deleted },
        ok: true,
        shardId,
        bounds,
        cellSize: Number.isFinite(cellSize) ? cellSize : 64,
        borderMargin,
        theme,
        epoch,
        commit,
        deleted,
        opsPreview,
        expectedConfirmToken: expectedConfirmToken ?? undefined,
        ...(wantList ? { list: listRows } : null),
      }
    : {
        kind: "mother_brain.wipe",
        summary: { total: wouldDelete },
        ok: true,
        shardId,
        bounds,
        cellSize: Number.isFinite(cellSize) ? cellSize : 64,
        borderMargin,
        theme,
        epoch,
        commit,
        wouldDelete,
        opsPreview,
        expectedConfirmToken: expectedConfirmToken ?? undefined,
        ...(wantList ? { list: listRows } : null),
      };
}

export function buildMotherBrainWipeInternalError(args: {
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin: number;
  theme: string | null;
  epoch: number | null;
  commit: boolean;
}): MotherBrainWipeResponse {
  const { shardId, bounds, cellSize, borderMargin, theme, epoch, commit } = args;
  return {
    ok: false,
    shardId,
    bounds,
    cellSize: Number.isFinite(cellSize) ? cellSize : 64,
    borderMargin,
    theme,
    epoch,
    commit,
    error: "internal_error",
  };
}
