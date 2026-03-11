// web-backend/routes/adminSpawnPoints/motherBrainWipeRequestOps.ts

import {
  parseCellBounds,
  toWorldBox,
  type CellBounds,
  type MotherBrainOpsPreview,
  type MotherBrainWipeRequest,
  type MotherBrainWipeResponse,
  type WorldBox,
} from "./opsPreview";
import { makeConfirmToken } from "./restoreRequestOps";

export type ParsedMotherBrainWipeRequest = {
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin: number;
  theme: string | null;
  epoch: number | null;
  commit: boolean;
  wantList: boolean;
  limit: number;
  confirm: string | null;
  parsedBounds: CellBounds;
  box: WorldBox;
};

export function parseMotherBrainWipeRequest(body: MotherBrainWipeRequest): ParsedMotherBrainWipeRequest {
  const shardId = String(body?.shardId ?? "prime_shard");
  const bounds = String(body?.bounds ?? "-1..1,-1..1");
  const cellSize = Math.max(1, Math.min(256, Number(body?.cellSize ?? 64) || 64));
  const borderMargin = Math.max(0, Math.min(25, Number(body?.borderMargin ?? 0) || 0));
  const theme = typeof body?.theme === "string" ? body.theme.trim() || null : body?.theme ?? null;
  const epoch = body?.epoch != null && Number.isFinite(Number(body.epoch)) ? Number(body.epoch) : null;
  const commit = Boolean(body?.commit ?? false);
  const wantList = Boolean(body?.list ?? false);
  const limit = Math.max(1, Math.min(500, Number(body?.limit ?? 25) || 25));
  const confirmRaw = body?.confirm;
  const confirm = typeof confirmRaw === "string" ? confirmRaw.trim() || null : null;
  const parsedBounds = parseCellBounds(bounds);
  const box = toWorldBox(parsedBounds, cellSize, borderMargin);

  return {
    shardId,
    bounds,
    cellSize,
    borderMargin,
    theme,
    epoch,
    commit,
    wantList,
    limit,
    confirm,
    parsedBounds,
    box,
  };
}

export function buildMotherBrainWipeBadBoundsResponse(args: {
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin: number;
  theme: string | null;
  epoch: number | null;
  commit: boolean;
  error: unknown;
}): MotherBrainWipeResponse {
  return {
    ok: false,
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize: args.cellSize,
    borderMargin: args.borderMargin,
    theme: args.theme,
    epoch: args.epoch,
    commit: args.commit,
    error: String((args.error as any)?.message ?? "bad_bounds"),
  };
}

export function buildMotherBrainWipeConfirmToken(args: {
  commit: boolean;
  wouldDelete: number;
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin: number;
  theme: string | null;
  epoch: number | null;
  box: WorldBox;
}): string | null {
  if (!args.commit || args.wouldDelete <= 0) return null;
  return makeConfirmToken("WIPE", args.shardId, {
    bounds: args.bounds,
    cellSize: args.cellSize,
    borderMargin: args.borderMargin,
    theme: args.theme,
    epoch: args.epoch,
    box: args.box,
    deleteScope: "brain:* selection (filtered by theme/epoch)",
  });
}

export function buildMotherBrainWipeConfirmRequiredResponse(args: {
  expectedConfirmToken: string;
  shardId: string;
  bounds: string;
  cellSize: number;
  borderMargin: number;
  theme: string | null;
  epoch: number | null;
  commit: boolean;
  wouldDelete: number;
  opsPreview: MotherBrainOpsPreview;
  listRows?: MotherBrainWipeResponse["list"];
}): MotherBrainWipeResponse {
  return {
    kind: "mother_brain.wipe",
    ok: false,
    error: "confirm_required",
    expectedConfirmToken: args.expectedConfirmToken,
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize: args.cellSize,
    borderMargin: args.borderMargin,
    theme: args.theme,
    epoch: args.epoch,
    commit: args.commit,
    wouldDelete: args.wouldDelete,
    opsPreview: args.opsPreview,
    ...(args.listRows ? { list: args.listRows } : null),
  };
}
