//web-backend/routes/adminSpawnPoints/snapshotStore.ts

import { createHash } from "crypto";
import { promises as fs } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";

export type CellBounds = { minCx: number; maxCx: number; minCz: number; maxCz: number };

export type SnapshotSpawnRow = {
  shardId: string;
  spawnId: string;
  type: string;
  protoId: string;
  archetype: string;
  variantId?: string | null;
  x: number;
  y: number;
  z: number;
  regionId?: string;
  townTier?: number | null;
};

export type SpawnSliceSnapshot = {
  kind: "admin.snapshot-spawns";
  version: 1;
  createdAt: string;
  shardId: string;
  bounds: CellBounds;
  cellSize: number;
  pad: number;
  types: string[];
  rows: number;
  spawns: SnapshotSpawnRow[];
};

export type StoredSpawnSnapshotDoc = {
  kind: "admin.stored-spawn-snapshot";
  version: 1 | 2 | 3;
  id: string;
  name: string;
  savedAt: string;
  tags: string[];
  notes?: string | null;
  isArchived?: boolean;
  isPinned?: boolean;
  expiresAt?: string | null;
  snapshot: SpawnSliceSnapshot;
};

export type StoredSpawnSnapshotMeta = {
  id: string;
  name: string;
  savedAt: string;
  shardId: string;
  rows: number;
  bounds: CellBounds;
  cellSize: number;
  pad: number;
  types: string[];
  bytes: number;
  tags: string[];
  notes?: string | null;
  isArchived?: boolean;
  isPinned?: boolean;
  expiresAt?: string | null;
};

const SNAPSHOT_DIR =
  typeof process.env.PLANARWAR_SPAWN_SNAPSHOT_DIR === "string" && process.env.PLANARWAR_SPAWN_SNAPSHOT_DIR.trim()
    ? path.resolve(process.env.PLANARWAR_SPAWN_SNAPSHOT_DIR.trim())
    : path.resolve(process.cwd(), "data", "spawn_snapshots");

export async function ensureSnapshotDir(): Promise<string> {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  return SNAPSHOT_DIR;
}

export function safeSnapshotName(name: string): string {
  const base = name.trim().slice(0, 80);
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]+/g, "_").replace(/\s+/g, " ");
  return cleaned || "snapshot";
}

export function normalizeSnapshotTags(input: unknown): string[] {
  const raw: string[] = [];
  if (Array.isArray(input)) {
    for (const it of input) raw.push(String(it ?? ""));
  } else if (typeof input === "string") {
    raw.push(...input.split(","));
  } else if (input != null) {
    raw.push(String(input));
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t0 = String(r ?? "").trim().toLowerCase();
    if (!t0) continue;
    const t1 = t0.replace(/\s+/g, "-").replace(/[^a-z0-9._-]+/g, "");
    const t = t1.slice(0, 32);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

export function safeSnapshotNotes(input: unknown): string | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 600);
}

export function boolish(input: unknown): boolean | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "boolean") return input;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "off") return false;
  return null;
}

export function coerceExpiresAt(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;

  if (typeof input === "number" && Number.isFinite(input)) {
    const days = Math.max(0, Math.min(3650, Math.floor(input)));
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const raw = String(input).trim();
  if (!raw) return null;

  const asNum = Number(raw);
  if (Number.isFinite(asNum) && /^\d+(\.0+)?$/.test(raw)) {
    const days = Math.max(0, Math.min(3650, Math.floor(asNum)));
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new Error("Invalid expiresAt (expected ISO date or days number).");
  return new Date(t).toISOString();
}

export function isExpired(expiresAt: unknown, nowMs = Date.now()): boolean {
  if (expiresAt == null) return false;
  const t = Date.parse(String(expiresAt));
  if (!Number.isFinite(t)) return false;
  return t <= nowMs;
}

function hashToken(input: unknown): string {
  return createHash("sha1").update(JSON.stringify(input)).digest("hex");
}

export function makeSnapshotId(name: string, shardId: string, bounds: CellBounds, types: string[]): string {
  const seed = { name: safeSnapshotName(name), shardId, bounds, types: [...types].sort() };
  return `snap_${Date.now()}_${hashToken(seed).slice(0, 12)}`;
}

export function metaFromStoredDoc(doc: StoredSpawnSnapshotDoc, bytes: number): StoredSpawnSnapshotMeta {
  return {
    id: doc.id,
    name: doc.name,
    savedAt: doc.savedAt,
    shardId: doc.snapshot.shardId,
    rows: doc.snapshot.rows,
    bounds: doc.snapshot.bounds,
    cellSize: doc.snapshot.cellSize,
    pad: doc.snapshot.pad,
    types: doc.snapshot.types,
    bytes,
    tags: Array.isArray((doc as any).tags) ? (doc as any).tags : [],
    notes: (doc as any).notes ?? null,
    isArchived: Boolean((doc as any).isArchived),
    isPinned: Boolean((doc as any).isPinned),
    expiresAt: ((doc as any).expiresAt ?? null) as any,
  };
}

export async function readStoredSnapshotById(id: string): Promise<{ doc: StoredSpawnSnapshotDoc; bytes: number }> {
  const dir = await ensureSnapshotDir();
  const file = path.join(dir, `${id}.json`);
  const raw = await fs.readFile(file, "utf8");
  const bytes = Buffer.byteLength(raw, "utf8");
  const doc = JSON.parse(raw) as StoredSpawnSnapshotDoc;
  if (!doc || doc.kind !== "admin.stored-spawn-snapshot") {
    throw new Error("Invalid stored snapshot file.");
  }
  return { doc, bytes };
}

export async function listStoredSnapshots(): Promise<StoredSpawnSnapshotMeta[]> {
  const dir = await ensureSnapshotDir();
  const names = await fs.readdir(dir).catch(() => []);
  const metas: StoredSpawnSnapshotMeta[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const file = path.join(dir, n);
    try {
      const raw = await fs.readFile(file, "utf8");
      const bytes = Buffer.byteLength(raw, "utf8");
      const doc = JSON.parse(raw) as StoredSpawnSnapshotDoc;
      if (!doc || doc.kind !== "admin.stored-spawn-snapshot") continue;
      metas.push(metaFromStoredDoc(doc, bytes));
    } catch {
      // ignore junk
    }
  }
  metas.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return metas;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function allocateSnapshotIdUnique(
  name: string,
  shardId: string,
  bounds: CellBounds,
  types: string[],
): Promise<string> {
  const dir = await ensureSnapshotDir();
  for (let i = 0; i < 6; i++) {
    const baseName = i === 0 ? name : `${name} copy ${i + 1}`;
    const id = makeSnapshotId(baseName, shardId, bounds, types);
    const file = path.join(dir, `${id}.json`);
    if (!(await fileExists(file))) return id;
    await new Promise((r) => setTimeout(r, 2));
  }
  return `snap_${Date.now()}_${Math.random().toString(16).slice(2, 10)}_${hashToken({ name, shardId, bounds, types }).slice(0, 8)}`;
}

export function coerceSnapshotSpawns(doc: unknown): {
  snapshotShard: string;
  bounds?: CellBounds;
  cellSize?: number;
  pad?: number;
  types?: string[];
  spawns: SnapshotSpawnRow[];
} {
  if (!doc || typeof doc !== "object") throw new Error("Invalid snapshot: not an object.");
  const anyDoc = doc as Record<string, unknown>;

  const shardIdRaw = anyDoc["shardId"];
  const snapshotShard = typeof shardIdRaw === "string" && shardIdRaw.length ? shardIdRaw : "prime_shard";

  const spawnsRaw = anyDoc["spawns"];
  if (!Array.isArray(spawnsRaw)) throw new Error("Invalid snapshot: missing 'spawns' array.");

  const spawns: SnapshotSpawnRow[] = [];
  for (const it of spawnsRaw) {
    const o = it as Record<string, unknown>;
    const spawnId = String(o["spawnId"] ?? "");
    if (!spawnId) continue;

    spawns.push({
      shardId: String(o["shardId"] ?? snapshotShard),
      spawnId,
      type: String(o["type"] ?? "unknown"),
      protoId: String(o["protoId"] ?? o["proto_id"] ?? "unknown"),
      archetype: String(o["archetype"] ?? "unknown"),
      variantId: o["variantId"] == null ? null : String(o["variantId"]),
      x: Number(o["x"] ?? 0),
      y: Number(o["y"] ?? 0),
      z: Number(o["z"] ?? 0),
      regionId: String(o["regionId"] ?? o["region_id"] ?? ""),
      townTier: o["townTier"] == null ? null : Number(o["townTier"]),
    });
  }

  let bounds: CellBounds | undefined;
  const boundsRaw = anyDoc["bounds"];
  if (boundsRaw && typeof boundsRaw === "object") {
    const b = boundsRaw as any;
    const minCx = Number(b.minCx);
    const maxCx = Number(b.maxCx);
    const minCz = Number(b.minCz);
    const maxCz = Number(b.maxCz);
    if ([minCx, maxCx, minCz, maxCz].every((n) => Number.isFinite(n))) {
      bounds = { minCx, maxCx, minCz, maxCz };
    }
  }

  const cellSize = Number(anyDoc["cellSize"]);
  const pad = Number(anyDoc["pad"]);
  const types = Array.isArray(anyDoc["types"]) ? (anyDoc["types"] as any[]).map((t) => String(t)) : undefined;

  return {
    snapshotShard,
    bounds,
    cellSize: Number.isFinite(cellSize) ? cellSize : undefined,
    pad: Number.isFinite(pad) ? pad : undefined,
    types,
    spawns,
  };
}
