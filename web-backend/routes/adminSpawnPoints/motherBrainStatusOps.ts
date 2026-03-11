//web-backend/routes/adminSpawnPoints/motherBrainStatusOps.ts

import {
  parseCellBounds,
  toWorldBox,
  type MotherBrainListRow,
  type MotherBrainStatusResponse,
  type WorldBox,
} from "./opsPreview";

type RawMotherBrainRow = {
  spawn_id?: unknown;
  type?: unknown;
  proto_id?: unknown;
  region_id?: unknown;
};

export type MotherBrainStatusRequest = {
  shardId: string;
  bounds: string;
  cellSize: number;
  theme: string | null;
  epoch: number | null;
  wantList: boolean;
  limit: number;
  box: WorldBox;
};

function strOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export function parseMotherBrainStatusRequest(query: Record<string, unknown>): MotherBrainStatusRequest {
  const shardId = strOrNull(query.shardId) ?? "prime_shard";
  const bounds = strOrNull(query.bounds) ?? "-1..1,-1..1";
  const cellSizeRaw = Number(query.cellSize ?? 64);
  const cellSize = Number.isFinite(cellSizeRaw) ? cellSizeRaw : 64;
  const theme = strOrNull(query.theme);
  const epochRaw = strOrNull(query.epoch);
  const epochNum = epochRaw != null ? Number(epochRaw) : null;
  const listRaw = String(query.list ?? "").trim().toLowerCase();
  const wantList = listRaw === "true" || listRaw === "1" || listRaw === "yes" || listRaw === "y";
  const limitRaw = Number(query.limit ?? 15);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 15));

  return {
    shardId,
    bounds,
    cellSize,
    theme,
    epoch: epochNum != null && Number.isFinite(epochNum) ? epochNum : null,
    wantList,
    limit,
    box: toWorldBox(parseCellBounds(bounds), cellSize, 0),
  };
}

export function isBrainSpawnId(spawnId: string): boolean {
  return spawnId.startsWith("brain:");
}

export function parseBrainSpawnId(spawnId: string): { epoch: number | null; theme: string | null } {
  // Prefer canonical format brain:<epoch>:<theme>:..., but tolerate older variants.
  const parts = String(spawnId ?? "").split(":");
  if (parts.length < 2) return { epoch: null, theme: null };

  const a = strOrNull(parts[1]);
  const b = strOrNull(parts[2]);

  const epochA = Number(a);
  if (Number.isFinite(epochA)) {
    return { epoch: epochA, theme: b };
  }

  const epochB = Number(b);
  if (Number.isFinite(epochB)) {
    return { epoch: epochB, theme: a };
  }

  return { epoch: null, theme: a };
}

export function buildMotherBrainStatusResponse(args: {
  rows: RawMotherBrainRow[];
  request: MotherBrainStatusRequest;
}): MotherBrainStatusResponse {
  const { rows, request } = args;
  const byTheme: Record<string, number> = {};
  const byEpoch: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const topProto: Record<string, number> = {};

  const filtered = (rows ?? []).filter((r) => {
    const sid = String(r.spawn_id ?? "");
    if (!isBrainSpawnId(sid)) return false;
    const meta = parseBrainSpawnId(sid);
    if (request.theme && meta.theme !== request.theme) return false;
    if (request.epoch != null && meta.epoch !== request.epoch) return false;
    return true;
  });

  for (const r of filtered) {
    const sid = String(r.spawn_id ?? "");
    const meta = parseBrainSpawnId(sid);
    const tTheme = meta.theme ?? "(unknown)";
    const tEpoch = meta.epoch != null ? String(meta.epoch) : "(unknown)";
    const tType = String(r.type ?? "(unknown)");
    const tProto = String(r.proto_id ?? "(none)");

    byTheme[tTheme] = (byTheme[tTheme] ?? 0) + 1;
    byEpoch[tEpoch] = (byEpoch[tEpoch] ?? 0) + 1;
    byType[tType] = (byType[tType] ?? 0) + 1;
    topProto[tProto] = (topProto[tProto] ?? 0) + 1;
  }

  const response: MotherBrainStatusResponse = {
    kind: "mother_brain.status",
    summary: { total: filtered.length, byType, byProtoId: topProto },
    ok: true,
    shardId: request.shardId,
    bounds: request.bounds,
    cellSize: request.cellSize,
    theme: request.theme,
    epoch: request.epoch,
    total: filtered.length,
    box: request.box,
    byTheme,
    byEpoch,
    byType,
    topProto,
  };

  if (request.wantList) {
    response.list = filtered
      .slice()
      .sort((a, b) => String(a.spawn_id ?? "").localeCompare(String(b.spawn_id ?? "")))
      .slice(0, request.limit)
      .map((r): MotherBrainListRow => ({
        spawnId: String(r.spawn_id ?? ""),
        type: String(r.type ?? ""),
        protoId: strOrNull(r.proto_id),
        regionId: strOrNull(r.region_id),
      }));
  }

  return response;
}
