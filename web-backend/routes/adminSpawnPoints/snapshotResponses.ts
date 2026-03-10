//web-backend/routes/adminSpawnPoints/snapshotResponses.ts

import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  boolish,
  coerceExpiresAt,
  ensureSnapshotDir,
  isExpired,
  metaFromStoredDoc,
  type CellBounds,
  type SnapshotSpawnRow,
  type SpawnSliceSnapshot,
  type StoredSpawnSnapshotDoc,
  type StoredSpawnSnapshotMeta,
} from "./snapshotStore";

export function buildSnapshotFromQuery(args: {
  shardId: string;
  spawns: SnapshotSpawnRow[];
  cellSize: number;
  pad: number;
  typeQ: string | null;
}): SpawnSliceSnapshot {
  const { shardId, spawns, cellSize, pad, typeQ } = args;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  if (spawns.length) {
    minX = Math.min(...spawns.map((s) => s.x));
    maxX = Math.max(...spawns.map((s) => s.x));
    minZ = Math.min(...spawns.map((s) => s.z));
    maxZ = Math.max(...spawns.map((s) => s.z));
  }

  const toCell = (v: number) => Math.floor(v / cellSize);
  const bounds: CellBounds = {
    minCx: toCell(minX) - pad,
    maxCx: toCell(maxX) + pad,
    minCz: toCell(minZ) - pad,
    maxCz: toCell(maxZ) + pad,
  };

  const types = typeQ ? [typeQ] : Array.from(new Set(spawns.map((s) => s.type))).slice(0, 50);

  return {
    kind: "admin.snapshot-spawns",
    version: 1,
    createdAt: new Date().toISOString(),
    shardId,
    bounds,
    cellSize,
    pad,
    types,
    rows: spawns.length,
    spawns,
  };
}

export function makeSnapshotQueryFilename(args: {
  shardId: string;
  regionId: string | null;
  x: number | null;
  z: number | null;
  radius: number | null;
}): string {
  const { shardId, regionId, x, z, radius } = args;
  const safeRegion = regionId
    ? `region_${regionId}`
    : x !== null && z !== null && radius !== null
      ? `r${radius}_x${x}_z${z}`
      : "query";
  return `snapshot_query_${new Date().toISOString().replace(/[:.]/g, "-")}_${shardId}_${safeRegion}.json`;
}

export async function saveStoredSnapshotDoc(doc: StoredSpawnSnapshotDoc): Promise<StoredSpawnSnapshotMeta> {
  const dir = await ensureSnapshotDir();
  const file = path.join(dir, `${doc.id}.json`);
  const raw = JSON.stringify(doc, null, 2) + "\n";
  await fs.writeFile(file, raw, "utf8");
  return metaFromStoredDoc(doc, Buffer.byteLength(raw, "utf8"));
}

export function filterAndSortSnapshots(args: {
  snapshots: StoredSpawnSnapshotMeta[];
  tag: string | null;
  q: string;
  sortRaw: string;
  pinnedOnly: boolean;
  includeArchived: boolean;
  includeExpired: boolean;
  limitRaw: number;
}): StoredSpawnSnapshotMeta[] {
  let { snapshots } = args;
  const { tag, q, sortRaw, pinnedOnly, includeArchived, includeExpired, limitRaw } = args;
  const nowMs = Date.now();

  if (!includeArchived) snapshots = snapshots.filter((s) => !Boolean((s as any).isArchived));
  if (!includeExpired) snapshots = snapshots.filter((s) => !isExpired((s as any).expiresAt, nowMs));
  if (pinnedOnly) snapshots = snapshots.filter((s) => Boolean((s as any).isPinned));
  if (tag) snapshots = snapshots.filter((s) => Array.isArray((s as any).tags) && (s as any).tags.includes(tag));
  if (q) {
    snapshots = snapshots.filter((s) => {
      const name = String((s as any).name || "").toLowerCase();
      const notes = String((s as any).notes || "").toLowerCase();
      const tags = Array.isArray((s as any).tags) ? (s as any).tags.join(" ").toLowerCase() : "";
      return name.includes(q) || notes.includes(q) || tags.includes(q);
    });
  }

  const savedAtDesc = (a: any, b: any) => String(b.savedAt).localeCompare(String(a.savedAt));
  if (sortRaw === "oldest") snapshots = snapshots.slice().sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
  else if (sortRaw === "name") snapshots = snapshots.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  else if (sortRaw === "pinned") {
    snapshots = snapshots.slice().sort((a, b) => {
      const ap = Boolean((a as any).isPinned);
      const bp = Boolean((b as any).isPinned);
      if (ap != bp) return ap ? -1 : 1;
      return savedAtDesc(a, b);
    });
  } else snapshots = snapshots.slice().sort(savedAtDesc);

  const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.min(500, Math.floor(limitRaw))) : 0;
  if (limit > 0) snapshots = snapshots.slice(0, limit);
  return snapshots;
}

export function buildUpdatedSnapshotDoc(args: {
  doc: StoredSpawnSnapshotDoc;
  nameRaw: string | null;
  tagsRaw: unknown;
  notesRaw: unknown;
  isArchivedRaw: unknown;
  isPinnedRaw: unknown;
  expiresAtRaw: unknown;
  normalizeTags: (value: unknown) => string[];
  safeName: (value: unknown) => string;
}): StoredSpawnSnapshotDoc {
  const { doc, nameRaw, tagsRaw, notesRaw, isArchivedRaw, isPinnedRaw, expiresAtRaw, normalizeTags, safeName } = args;
  const nextName = nameRaw ? safeName(nameRaw) : doc.name;
  const nextTags = tagsRaw !== undefined ? normalizeTags(tagsRaw) : (Array.isArray((doc as any).tags) ? (doc as any).tags : []);
  const nextNotes = notesRaw === undefined ? ((doc as any).notes ?? null) : notesRaw === null ? null : String(notesRaw).slice(0, 2000);
  const prevArchived = Boolean((doc as any).isArchived);
  const prevPinned = Boolean((doc as any).isPinned);
  const prevExpiresAt = ((doc as any).expiresAt ?? null) as any;
  const archivedBool = boolish(isArchivedRaw);
  const pinnedBool = boolish(isPinnedRaw);
  const nextArchived = archivedBool === null ? prevArchived : archivedBool;
  const nextPinned = pinnedBool === null ? prevPinned : pinnedBool;
  let nextExpiresAt: string | null = prevExpiresAt;
  const expiresAtCoerced = coerceExpiresAt(expiresAtRaw);
  if (expiresAtCoerced !== undefined) nextExpiresAt = expiresAtCoerced;
  return {
    ...doc,
    version: 3,
    name: nextName,
    tags: nextTags,
    notes: nextNotes,
    isArchived: nextArchived,
    isPinned: nextPinned,
    expiresAt: nextExpiresAt,
  };
}
