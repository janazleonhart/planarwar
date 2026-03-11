//web-backend/routes/adminSpawnPoints/snapshotRequestParsers.ts

import { normalizeSnapshotTags, safeSnapshotNotes } from "./snapshotStore";
import { parseSpawnPointQueryFilters } from "./snapshotQueryFilters";

type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";

type ParserHelpers = {
  boolish: (v: unknown) => boolean | null;
  numOrNull: (v: unknown) => number | null;
  strOrNull: (v: unknown) => string | null;
  normalizeAuthority: (v: unknown) => SpawnAuthority | null;
};

export const SNAPSHOT_QUERY_MAX_ROWS = 5000;

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((t) => String(t)).filter(Boolean) : [];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function parseSnapshotCaptureRequest(body: any, helpers: ParserHelpers): {
  shardId: string;
  boundsRaw: string | null;
  types: string[];
  cellSize: number;
  pad: number;
} {
  return {
    shardId: helpers.strOrNull(body?.shardId) ?? "prime_shard",
    boundsRaw: helpers.strOrNull(body?.bounds),
    types: parseStringArray(body?.types),
    cellSize: Math.max(1, Number(body?.cellSize) || 512),
    pad: Math.max(0, Number(body?.pad) || 0),
  };
}

export function parseSnapshotQueryRequest(source: any, helpers: ParserHelpers): {
  filters: ReturnType<typeof parseSpawnPointQueryFilters>;
  cellSize: number;
  pad: number;
  maxRows: number;
} {
  return {
    filters: parseSpawnPointQueryFilters(source, helpers),
    cellSize: clampInt(source?.cellSize, 1, 1024, 64),
    pad: clampInt(source?.pad, 0, 1000, 0),
    maxRows: SNAPSHOT_QUERY_MAX_ROWS,
  };
}

export function parseSnapshotSaveQueryRequest(body: any, helpers: ParserHelpers): {
  nameRaw: string | null;
  tags: string[];
  notes: string;
  filters: ReturnType<typeof parseSpawnPointQueryFilters>;
  cellSize: number;
  pad: number;
  maxRows: number;
} {
  const parsed = parseSnapshotQueryRequest(body, helpers);
  return {
    nameRaw: helpers.strOrNull(body?.name),
    tags: normalizeSnapshotTags(body?.tags),
    notes: safeSnapshotNotes(body?.notes),
    ...parsed,
  };
}

export function parseStoredSnapshotListRequest(query: any, helpers: ParserHelpers): {
  tag: string | null;
  q: string;
  sortRaw: string;
  limitRaw: number;
  pinnedOnly: boolean;
  includeArchived: boolean;
  includeExpired: boolean;
} {
  const tagRaw = helpers.strOrNull(query?.tag);
  return {
    tag: tagRaw ? normalizeSnapshotTags(tagRaw)[0] ?? null : null,
    q: (helpers.strOrNull(query?.q) || "").trim().toLowerCase(),
    sortRaw: (helpers.strOrNull(query?.sort) || "newest").toLowerCase(),
    limitRaw: Number(query?.limit),
    pinnedOnly: helpers.boolish(query?.pinnedOnly) === true,
    includeArchived: helpers.boolish(query?.includeArchived) === true,
    includeExpired: helpers.boolish(query?.includeExpired) === true,
  };
}
