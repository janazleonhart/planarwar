// web-backend/routes/adminSpawnPoints.ts

import { Router } from "express";
import { createHash } from "crypto";
import { promises as fs } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { db } from "../../worldcore/db/Database";
import { clearSpawnPointCache } from "../../worldcore/world/SpawnPointCache";
import { getSpawnAuthority, isSpawnEditable } from "../../worldcore/world/spawnAuthority";
import { planBrainWave } from "../../worldcore/sim/MotherBrainWavePlanner";
import {
  computeBrainWaveApplyPlan,
  computeBrainWaveBudgetReport,
  filterPlannedActionsToBudget,
  computeBrainWipePlan,
} from "../../worldcore/sim/MotherBrainWaveOps";
import { planTownBaselines } from "../../worldcore/sim/TownBaselinePlanner";
import type { TownBaselinePlanOptions, TownLikeSpawnRow } from "../../worldcore/sim/TownBaselinePlanner";
import { getStationProtoIdsForTier } from "../../worldcore/world/TownTierRules";

const router = Router();

type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";

type SpawnOwnerKind = "brain" | "baseline" | "editor" | "system";

type AdminSpawnPoint = {
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

  // Ownership / reconciliation (v0.2)
  ownerKind?: SpawnOwnerKind | null;
  ownerId?: string | null;
  isLocked?: boolean | null;

  // server-provided convenience
  authority?: SpawnAuthority;
};

type CloneScatterSuccess = {
  ok: true;
  inserted: number;
  skippedBrainOwned: number;
  skippedMissingCoords: number;
  failedToPlace: number;
  createdIds: number[];
  createdSpawnIds: string[];
};

type CloneScatterFailure = {
  ok: false;
  inserted: number;
  skippedBrainOwned: number;
  skippedMissingCoords: number;
  failedToPlace: number;
  createdIds: number[];
  createdSpawnIds: string[];
  error: string;
};

type CloneScatterResponse = CloneScatterSuccess | CloneScatterFailure;

type AdminApiKind =
  | "spawn_points.list"
  | "spawn_points.upsert"
  | "spawn_points.delete"
  | "spawn_points.bulk_delete"
  | "spawn_points.bulk_move"
  | "spawn_points.clone"
  | "spawn_points.scatter"
  | "spawn_points.snapshot"
  | "spawn_points.snapshot_query"
  | "spawn_points.snapshots.save_query"
  | "spawn_points.restore"
  | "town_baseline.plan"
  | "town_baseline.apply"
  | "mother_brain.status"
  | "mother_brain.wave"
  | "mother_brain.wipe";

type AdminSummary = {
  total: number;
  byType?: Record<string, number>;
  byProtoId?: Record<string, number>;
};

function summarizePlannedSpawns(
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


function buildTownBaselineOpsPreview(planItems: TownBaselinePlanItem[], limit = 75): TownBaselineOpsPreview {
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

  const truncated = inserts.length > limit || updates.length > limit || protectedUpdates.length > limit || skips.length > limit || readOnly.length > limit;

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


type SnapshotSpawnRow = {
  shardId: string;
  spawnId: string;
  type: string;
  protoId: string;
  archetype: string;
  variantId: string | null;
  x: number;
  y: number;
  z: number;
  regionId: string;
  townTier?: number | null;
};

type SpawnSliceSnapshot = {
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

type SpawnSliceOpsPreview = {
  limit: number;
  truncated: boolean;

  // list-style (truncated IDs) + full counts for accurate UI summaries
  insertSpawnIds: string[];
  insertCount: number;
  updateSpawnIds: string[];
  updateCount: number;
  skipSpawnIds: string[];
  skipCount: number;
  readOnlySpawnIds: string[];
  readOnlyCount: number;

  // P5: mismatch signal (rows currently in target slice but not present in snapshot)
  extraTargetSpawnIds?: string[];
  extraTargetCount?: number;
};

type StoredSpawnSnapshotDoc = {
  kind: "admin.stored-spawn-snapshot";
  version: 1 | 2;
  id: string;
  name: string;
  savedAt: string;

  // P3: metadata for discoverability
  tags: string[];
  notes?: string | null;

  snapshot: SpawnSliceSnapshot;
};

type DuplicateSnapshotResponse =
  | { kind: "spawn_points.snapshots.duplicate"; ok: true; snapshot: StoredSpawnSnapshotMeta }
  | { kind: "spawn_points.snapshots.duplicate"; ok: false; error: string };

type StoredSpawnSnapshotMeta = {
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

  // P3: metadata for discoverability
  tags: string[];
  notes?: string | null;
};

const SNAPSHOT_DIR =
  typeof process.env.PLANARWAR_SPAWN_SNAPSHOT_DIR === "string" && process.env.PLANARWAR_SPAWN_SNAPSHOT_DIR.trim()
    ? path.resolve(process.env.PLANARWAR_SPAWN_SNAPSHOT_DIR.trim())
    : path.resolve(process.cwd(), "data", "spawn_snapshots");

async function ensureSnapshotDir(): Promise<string> {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  return SNAPSHOT_DIR;
}

function safeSnapshotName(name: string): string {
  const base = name.trim().slice(0, 80);
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]+/g, "_").replace(/\s+/g, " ");
  return cleaned || "snapshot";
}


function normalizeSnapshotTags(input: unknown): string[] {
  // Accept: ["tag1", "tag2"] OR "tag1, tag2" OR single string.
  // Normalize: lowercase, trim, spaces -> "-", allow [a-z0-9._-], dedupe, cap.
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
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

function safeSnapshotNotes(input: unknown): string | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  // Keep it boring: strip control chars, cap length.
  const cleaned = s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 600);
}


function makeSnapshotId(name: string, shardId: string, bounds: CellBounds, types: string[]): string {
  const seed = { name: safeSnapshotName(name), shardId, bounds, types: [...types].sort() };
  return `snap_${Date.now()}_${hashToken(seed).slice(0, 12)}`;
}

function metaFromStoredDoc(doc: StoredSpawnSnapshotDoc, bytes: number): StoredSpawnSnapshotMeta {
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
  };
}

async function readStoredSnapshotById(id: string): Promise<{ doc: StoredSpawnSnapshotDoc; bytes: number }> {
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

async function listStoredSnapshots(): Promise<StoredSpawnSnapshotMeta[]> {
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

async function allocateSnapshotIdUnique(name: string, shardId: string, bounds: CellBounds, types: string[]): Promise<string> {
  // Extremely low contention; keep it simple but deterministic enough.
  const dir = await ensureSnapshotDir();
  for (let i = 0; i < 6; i++) {
    const baseName = i === 0 ? name : `${name} copy ${i + 1}`;
    const id = makeSnapshotId(baseName, shardId, bounds, types);
    const file = path.join(dir, `${id}.json`);
    if (!(await fileExists(file))) return id;
    // If collision (very unlikely), try again.
    await new Promise((r) => setTimeout(r, 2));
  }
  // Final fallback: add entropy.
  const id = `snap_${Date.now()}_${Math.random().toString(16).slice(2, 10)}_${hashToken({ name, shardId, bounds, types }).slice(0, 8)}`;
  return id;
}


function coerceSnapshotSpawns(doc: unknown): { snapshotShard: string; bounds?: CellBounds; cellSize?: number; pad?: number; types?: string[]; spawns: SnapshotSpawnRow[] } {
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

  // Optional passthrough metadata (used only for UI display)
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

function buildSpawnSliceOpsPreview(args: {
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

function hashToken(input: unknown): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return createHash("sha256").update(s).digest("hex").slice(0, 10);
}

function makeConfirmToken(prefix: "WIPE" | "REPLACE", shardId: string, scope: unknown): string {
  // Token format: PREFIX:<shardId>:<shortHash>
  return `${prefix}:${shardId}:${hashToken(scope)}`;
}

function cloneScatterFail(error: string): CloneScatterFailure {
  return {
    ok: false,
    inserted: 0,
    skippedBrainOwned: 0,
    skippedMissingCoords: 0,
    failedToPlace: 0,
    createdIds: [],
    createdSpawnIds: [],
    error,
  };
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: any): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function strOrUndef(v: any): string | undefined {
  const s = strOrNull(v);
  return s === null ? undefined : s;
}

function requiredStr(v: any): string {
  return String(v ?? "").trim();
}

function normalizeAuthority(a: any): SpawnAuthority | null {
  const s = String(a ?? "").trim().toLowerCase();
  if (s === "anchor" || s === "seed" || s === "brain" || s === "manual") return s as SpawnAuthority;
  return null;
}

function validateUpsert(p: AdminSpawnPoint): string | null {
  const shardId = requiredStr(p.shardId);
  const spawnId = requiredStr(p.spawnId);
  const type = requiredStr(p.type);
  const archetype = requiredStr(p.archetype);

  if (!shardId) return "shardId is required";
  if (!spawnId) return "spawnId is required";
  if (!type) return "type is required";
  if (!archetype) return "archetype is required";

  if (!isSpawnEditable(spawnId)) {
    return `Spawn '${spawnId}' is brain-owned and cannot be edited here.`;
  }

  const authority = getSpawnAuthority(spawnId);
  const protoId = strOrNull(p.protoId);

  // If spawnId uses authority prefixes, protoId MUST be present
  if ((authority === "anchor" || authority === "seed") && !protoId) {
    return "protoId is required for anchor/seed spawn points (spawnId has prefix).";
  }

  // If it's an NPC/node spawn, protoId should be present (otherwise spawnId fallback can be wrong)
  const t = type.toLowerCase();
  if (
    (t === "npc" || t === "mob" || t === "creature" || t === "node" || t === "resource") &&
    !protoId
  ) {
    return "protoId is required for npc/node/resource spawn points.";
  }

  // Anchor/seed should have region + coordinates (otherwise placement editor is pointless)
  const regionId = strOrNull(p.regionId);
  const x = numOrNull(p.x);
  const z = numOrNull(p.z);

  if ((authority === "anchor" || authority === "seed") && !regionId) {
    return "regionId is required for anchor/seed spawn points.";
  }
  if ((authority === "anchor" || authority === "seed") && (x === null || z === null)) {
    return "x and z are required for anchor/seed spawn points.";
  }

  return null;
}

function mapRowToAdmin(r: any): AdminSpawnPoint {
  const spawnId = String(r.spawn_id ?? "");
  return {
    id: Number(r.id),
    shardId: String(r.shard_id ?? ""),
    spawnId,
    type: String(r.type ?? ""),
    archetype: String(r.archetype ?? ""),
    protoId: r.proto_id ?? null,
    variantId: r.variant_id ?? null,
    x: r.x ?? null,
    y: r.y ?? null,
    z: r.z ?? null,
    regionId: r.region_id ?? null,
    townTier: r.town_tier ?? null,
    ownerKind: (r.owner_kind ?? null) as any,
    ownerId: r.owner_id ?? null,
    isLocked: r.is_locked ?? null,
    authority: getSpawnAuthority(spawnId),
  };
}

// ------------------------------
// Spawn points CRUD
// ------------------------------

// GET /api/admin/spawn_points?shardId=prime_shard&regionId=prime_shard:0,0
// GET /api/admin/spawn_points?shardId=prime_shard&x=0&z=0&radius=500
//
// Optional filters:
//   authority=anchor|seed|manual|brain
//   type=<exact, case-insensitive>
//   archetype=<exact, case-insensitive>
//   protoId=<substring, ilike>
//   spawnId=<substring, ilike>
//   limit=<1..1000>

// --- Proto options (UI helpers) ---
type ProtoOptionKind = "resource" | "station";
type ProtoOption = { id: string; label: string; kind: ProtoOptionKind };

function uniqSorted(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function resolveResourcesDir(): Promise<{ dir: string | null; tried: string[] }> {
  const tried: string[] = [];
  const candidates = [
    // repo root (common in dev)
    path.resolve(process.cwd(), "web-backend", "data", "resources"),
    // when cwd is web-backend/
    path.resolve(process.cwd(), "data", "resources"),
    // compiled dist locations
    path.resolve(__dirname, "..", "data", "resources"),
    path.resolve(__dirname, "..", "..", "data", "resources"),
    path.resolve(__dirname, "..", "..", "..", "web-backend", "data", "resources"),
  ];

  for (const c of candidates) {
    tried.push(c);
    try {
      const st = await fs.stat(c);
      if (st.isDirectory()) return { dir: c, tried };
    } catch {
      // ignore
    }
  }
  return { dir: null, tried };
}

async function loadResourceProtoIdsFromDataDir(): Promise<{ ids: string[]; dir: string | null; tried: string[] }> {
  const { dir, tried } = await resolveResourcesDir();
  if (!dir) return { ids: [], dir: null, tried };

  const ids: string[] = [];
  const files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith(".json"));

  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const raw = await fs.readFile(full, "utf-8");
      const data = JSON.parse(raw);

      // Expected format: [{ id: "ore_iron_hematite", ... }, ...]
      if (Array.isArray(data)) {
        for (const row of data) {
          const id = row && typeof row.id === "string" ? row.id : null;
          if (id) ids.push(id);
        }
      }
    } catch {
      // Ignore parse errors; this is an admin convenience endpoint.
    }
  }

  return { ids: uniqSorted(ids), dir, tried };
}

function toTitle(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

router.get("/proto_options", async (_req, res) => {
  try {
    // Resources (from web-backend/data/resources/*.json)
    const resources = await loadResourceProtoIdsFromDataDir();

    // Station proto ids (union across tiers)
    const stationIds: string[] = [];
    for (let tier = 1; tier <= 10; tier++) {
      try {
        stationIds.push(...getStationProtoIdsForTier(tier));
      } catch {
        // ignore
      }
    }

    const resourceIds = resources.ids;
    const stations = uniqSorted(stationIds);

    // Try to decorate resource ids with item names (when resource proto ids align with items.id)
    const itemLabels = new Map<string, string>();
    if (resourceIds.length) {
      try {
        const r = await db.query(
          "SELECT id, name FROM items WHERE id = ANY($1::text[])",
          [resourceIds],
        );
        for (const row of r.rows ?? []) {
          if (row?.id && row?.name) itemLabels.set(String(row.id), String(row.name));
        }
      } catch {
        // ignore
      }
    }

    const options: ProtoOption[] = [
      ...resourceIds.map((id) => ({
        id,
        kind: "resource" as const,
        label: itemLabels.get(id) ? `${itemLabels.get(id)} (${id})` : `${toTitle(id)} (${id})`,
      })),
      ...stations.map((id) => ({
        id,
        kind: "station" as const,
        label: `Station: ${toTitle(id)} (${id})`,
      })),
    ];

    return res.json({
      ok: true,
      protoOptions: options,
      resourceProtoIds: resourceIds,
      stationProtoIds: stations,
      resourcesDir: resources.dir,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/", async (req, res) => {
  try {
    const shardId = String(req.query.shardId ?? "prime_shard").trim();

    const regionId = strOrNull(req.query.regionId);
    const x = numOrNull(req.query.x);
    const z = numOrNull(req.query.z);
    const radius = numOrNull(req.query.radius);

    const authority = normalizeAuthority(req.query.authority);
    const typeQ = strOrNull(req.query.type);
    const archetypeQ = strOrNull(req.query.archetype);
    const protoQ = strOrNull(req.query.protoId);
    const spawnQ = strOrNull(req.query.spawnId);

    const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 200)));

    const where: string[] = ["shard_id = $1"];
    const args: any[] = [shardId];
    let i = 2;

    // Mode: region
    if (regionId) {
      where.push(`region_id = $${i++}`);
      args.push(regionId);
    }

    // Mode: radius (only if no regionId)
    if (!regionId && x !== null && z !== null && radius !== null) {
      const safeRadius = Math.max(0, Math.min(radius, 10_000));
      const r2 = safeRadius * safeRadius;

      where.push(`x IS NOT NULL AND z IS NOT NULL`);
      where.push(`((x - $${i}) * (x - $${i}) + (z - $${i + 1}) * (z - $${i + 1})) <= $${i + 2}`);
      args.push(x, z, r2);
      i += 3;
    }

    // Filters
    if (authority) {
      if (authority === "anchor") where.push(`spawn_id LIKE 'anchor:%'`);
      else if (authority === "seed") where.push(`spawn_id LIKE 'seed:%'`);
      else if (authority === "brain") where.push(`spawn_id LIKE 'brain:%'`);
      else {
        // manual = not any of the known prefixes
        where.push(`spawn_id NOT LIKE 'anchor:%' AND spawn_id NOT LIKE 'seed:%' AND spawn_id NOT LIKE 'brain:%'`);
      }
    }

    if (typeQ) {
      where.push(`LOWER(type) = LOWER($${i++})`);
      args.push(typeQ);
    }

    if (archetypeQ) {
      where.push(`LOWER(archetype) = LOWER($${i++})`);
      args.push(archetypeQ);
    }

    if (protoQ) {
      where.push(`proto_id ILIKE $${i++}`);
      args.push(`%${protoQ}%`);
    }

    if (spawnQ) {
      where.push(`spawn_id ILIKE $${i++}`);
      args.push(`%${spawnQ}%`);
    }

    const sql = `
      SELECT
        id,
        shard_id,
        spawn_id,
        type,
        archetype,
        proto_id,
        variant_id,
        x,
        y,
        z,
        region_id,
        town_tier,
        owner_kind,
        owner_id,
        is_locked
      FROM spawn_points
      WHERE ${where.join(" AND ")}
      ORDER BY id ASC
      LIMIT $${i}
    `;

    args.push(limit);

    const r = await db.query(sql, args);
    const rows = r.rows ?? [];

    res.json({
      ok: true,
      spawnPoints: rows.map(mapRowToAdmin),
      total: rows.length,
    });
  } catch (err) {
    console.error("[ADMIN/SPAWN_POINTS] list error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/", async (req, res) => {
  const body = req.body as AdminSpawnPoint;

  const msg = validateUpsert(body);
  if (msg) {
    return res.status(400).json({ ok: false, error: msg });
  }

  const id = Number(body.id ?? 0);
  const shardId = requiredStr(body.shardId);
  const spawnId = requiredStr(body.spawnId);

  const type = requiredStr(body.type);
  const archetype = requiredStr(body.archetype);

  const protoId = strOrNull(body.protoId);
  const variantId = strOrNull(body.variantId);

  const x = numOrNull(body.x);
  const y = numOrNull(body.y);
  const z = numOrNull(body.z);

  const regionId = strOrNull(body.regionId);
  const townTier = numOrNull(body.townTier);

  try {
    let newId: number | null = null;

    if (id && id > 0) {
      await db.query(
        `
        UPDATE spawn_points
        SET
          shard_id = $2,
          spawn_id = $3,
          type = $4,
          archetype = $5,
          proto_id = $6,
          variant_id = $7,
          x = $8,
          y = $9,
          z = $10,
          region_id = $11,
          town_tier = $12
        WHERE id = $1
        `,
        [id, shardId, spawnId, type, archetype, protoId, variantId, x, y, z, regionId, townTier],
      );
      newId = id;
    } else {
      const ins = await db.query(
        `
        INSERT INTO spawn_points
          (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier, owner_kind, owner_id)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'editor',NULL)
        RETURNING id
        `,
        [shardId, spawnId, type, archetype, protoId, variantId, x, y, z, regionId, townTier],
      );
      newId = Number(ins.rows?.[0]?.id ?? 0) || null;
    }

    // Clear any in-proc caches (helps when web-backend shares runtime with worldcore server).
    clearSpawnPointCache();

    res.json({ ok: true, id: newId });
  } catch (err) {
    console.error("[ADMIN/SPAWN_POINTS] upsert error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// DELETE /api/admin/spawn_points/:id?shardId=prime_shard
router.delete("/:id", async (req, res) => {
  try {
    const shardId = String(req.query.shardId ?? "prime_shard").trim();
    const id = Number(req.params.id ?? 0);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const row = await db.query(
      `SELECT id, shard_id, spawn_id, owner_kind, is_locked FROM spawn_points WHERE id = $1 LIMIT 1`,
      [id],
    );

    const found = row.rows?.[0];
    if (!found) return res.status(404).json({ ok: false, error: "not_found" });
    if (String(found.shard_id) !== shardId) return res.status(403).json({ ok: false, error: "shard_mismatch" });

    if (Boolean(found.is_locked)) {
      return res.status(403).json({ ok: false, error: "locked_readonly" });
    }

    const spawnId = String(found.spawn_id ?? "");
    // brain:* is normally readonly, but explicit editor ownership can override.
    const ownerKind = String(found.owner_kind ?? "").trim().toLowerCase();
    const isEditorOwned = ownerKind === "editor";

    if (!isEditorOwned && !isSpawnEditable(spawnId)) {
      return res.status(403).json({ ok: false, error: "brain_owned_readonly" });
    }

    await db.query(`DELETE FROM spawn_points WHERE id = $1`, [id]);
    clearSpawnPointCache();

    res.json({ ok: true, deleted: 1 });
  } catch (err) {
    console.error("[ADMIN/SPAWN_POINTS] delete error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ------------------------------
// Spawn ownership / reconciliation (v0.2)
// ------------------------------

type OwnershipUpdateResponse = {
  ok: boolean;
  kind: "spawn_points.ownership";
  spawnPoint?: AdminSpawnPoint;
  error?: string;
};

async function readSpawnPointRowById(id: number): Promise<any | null> {
  const r = await db.query(
    `
    SELECT
      id,
      shard_id,
      spawn_id,
      type,
      archetype,
      proto_id,
      variant_id,
      x,
      y,
      z,
      region_id,
      town_tier,
      owner_kind,
      owner_id,
      is_locked
    FROM spawn_points
    WHERE id = $1
    LIMIT 1
    `,
    [id],
  );
  return r.rows?.[0] ?? null;
}

function computeDefaultOwnerKindForSpawnId(spawnId: string): SpawnOwnerKind | null {
  const sid = String(spawnId ?? "").trim().toLowerCase();
  if (sid.startsWith("seed:")) return "baseline";
  if (sid.startsWith("brain:")) return "brain";
  return null;
}

// POST /api/admin/spawn_points/:id/adopt
// Body: { ownerId?: string }
router.post("/:id/adopt", async (req, res) => {
  try {
    const id = Number(req.params.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, kind: "spawn_points.ownership", error: "invalid_id" } satisfies OwnershipUpdateResponse);
    }

    const ownerId = strOrNull((req.body ?? {})?.ownerId);

    const found = await readSpawnPointRowById(id);
    if (!found) {
      return res.status(404).json({ ok: false, kind: "spawn_points.ownership", error: "not_found" } satisfies OwnershipUpdateResponse);
    }

    // Locked rows can still be adopted (ownership is metadata), but remain protected by the lock.
    await db.query(
      `
      UPDATE spawn_points
      SET
        owner_kind = 'editor',
        owner_id = $2,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id, ownerId],
    );

    const updated = await readSpawnPointRowById(id);
    clearSpawnPointCache();

    return res.json({ ok: true, kind: "spawn_points.ownership", spawnPoint: mapRowToAdmin(updated) } satisfies OwnershipUpdateResponse);
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] adopt error", err);
    return res.status(500).json({ ok: false, kind: "spawn_points.ownership", error: "internal_error" } satisfies OwnershipUpdateResponse);
  }
});

// POST /api/admin/spawn_points/:id/release
router.post("/:id/release", async (req, res) => {
  try {
    const id = Number(req.params.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, kind: "spawn_points.ownership", error: "invalid_id" } satisfies OwnershipUpdateResponse);
    }

    const found = await readSpawnPointRowById(id);
    if (!found) {
      return res.status(404).json({ ok: false, kind: "spawn_points.ownership", error: "not_found" } satisfies OwnershipUpdateResponse);
    }

    const spawnId = String(found.spawn_id ?? "");
    const nextOwner = computeDefaultOwnerKindForSpawnId(spawnId);

    await db.query(
      `
      UPDATE spawn_points
      SET
        owner_kind = $2,
        owner_id = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id, nextOwner],
    );

    const updated = await readSpawnPointRowById(id);
    clearSpawnPointCache();

    return res.json({ ok: true, kind: "spawn_points.ownership", spawnPoint: mapRowToAdmin(updated) } satisfies OwnershipUpdateResponse);
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] release error", err);
    return res.status(500).json({ ok: false, kind: "spawn_points.ownership", error: "internal_error" } satisfies OwnershipUpdateResponse);
  }
});

// POST /api/admin/spawn_points/:id/lock
router.post("/:id/lock", async (req, res) => {
  try {
    const id = Number(req.params.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, kind: "spawn_points.ownership", error: "invalid_id" } satisfies OwnershipUpdateResponse);
    }

    const found = await readSpawnPointRowById(id);
    if (!found) {
      return res.status(404).json({ ok: false, kind: "spawn_points.ownership", error: "not_found" } satisfies OwnershipUpdateResponse);
    }

    await db.query(
      `
      UPDATE spawn_points
      SET
        is_locked = TRUE,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id],
    );

    const updated = await readSpawnPointRowById(id);
    clearSpawnPointCache();
    return res.json({ ok: true, kind: "spawn_points.ownership", spawnPoint: mapRowToAdmin(updated) } satisfies OwnershipUpdateResponse);
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] lock error", err);
    return res.status(500).json({ ok: false, kind: "spawn_points.ownership", error: "internal_error" } satisfies OwnershipUpdateResponse);
  }
});

// POST /api/admin/spawn_points/:id/unlock
router.post("/:id/unlock", async (req, res) => {
  try {
    const id = Number(req.params.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, kind: "spawn_points.ownership", error: "invalid_id" } satisfies OwnershipUpdateResponse);
    }

    const found = await readSpawnPointRowById(id);
    if (!found) {
      return res.status(404).json({ ok: false, kind: "spawn_points.ownership", error: "not_found" } satisfies OwnershipUpdateResponse);
    }

    await db.query(
      `
      UPDATE spawn_points
      SET
        is_locked = FALSE,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id],
    );

    const updated = await readSpawnPointRowById(id);
    clearSpawnPointCache();
    return res.json({ ok: true, kind: "spawn_points.ownership", spawnPoint: mapRowToAdmin(updated) } satisfies OwnershipUpdateResponse);
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] unlock error", err);
    return res.status(500).json({ ok: false, kind: "spawn_points.ownership", error: "internal_error" } satisfies OwnershipUpdateResponse);
  }
});


// ------------------------------
// Bulk ownership ops (from current query) (v0.8)
// ------------------------------

type BulkOwnershipQueryAction = "adopt" | "release" | "lock" | "unlock";

type BulkOwnershipQuery = {
  shardId?: string;
  // Match the list endpoint filters (region OR radius) + optional filters
  regionId?: string | null;
  x?: number | null;
  z?: number | null;
  radius?: number | null;
  authority?: SpawnAuthority | null;
  type?: string | null;
  archetype?: string | null;
  protoId?: string | null;
  spawnId?: string | null;
};

type BulkOwnershipQueryRequest = {
  shardId?: string;
  action: BulkOwnershipQueryAction;
  query?: BulkOwnershipQuery;
  ownerId?: string | null;
  commit?: boolean;
  confirm?: string | null;
};

type BulkOwnershipOpsPreview = {
  limit: number;
  truncated: boolean;
  changeSpawnIds: string[];
  changeCount: number;
  readOnlySpawnIds: string[];
  readOnlyCount: number;
  noOpCount: number;
  sampleRows?: Array<{
    spawnId: string;
    ownerKind: string | null;
    ownerId: string | null;
    isLocked: boolean;
    wouldChange: boolean;
    reason: "change" | "readOnly" | "noOp";
  }>;
};

type BulkOwnershipQueryResponseOk = {
  kind: "spawn_points.bulk_ownership";
  ok: true;
  action: BulkOwnershipQueryAction;
  shardId: string;
  matched: number;
  wouldChange: number;
  skippedReadOnly: number;
  skippedNoOp: number;
  expectedConfirmToken?: string;
  opsPreview?: BulkOwnershipOpsPreview;
  commit?: boolean;
  changed?: number;
};

type BulkOwnershipQueryResponseErr = {
  kind: "spawn_points.bulk_ownership";
  ok: false;
  error: string;
  // Optional context fields so callers can still include useful counts without fighting TS.
  action?: BulkOwnershipQueryAction;
  shardId?: string;
  matched?: number;
  wouldChange?: number;
  skippedReadOnly?: number;
  skippedNoOp?: number;
  expectedConfirmToken?: string;
  opsPreview?: BulkOwnershipOpsPreview;
  commit?: boolean;
  changed?: number;
};

type BulkOwnershipQueryResponse = BulkOwnershipQueryResponseOk | BulkOwnershipQueryResponseErr;

function buildWhereFromQueryFilters(shardId: string, q: BulkOwnershipQuery): { whereSql: string; args: any[] } {
  const regionId = strOrNull(q.regionId);
  const x = numOrNull(q.x);
  const z = numOrNull(q.z);
  const radius = numOrNull(q.radius);

  const authority = normalizeAuthority(q.authority);
  const typeQ = strOrNull(q.type);
  const archetypeQ = strOrNull(q.archetype);
  const protoQ = strOrNull(q.protoId);
  const spawnQ = strOrNull(q.spawnId);

  const where: string[] = ["shard_id = $1"];
  const args: any[] = [shardId];
  let i = 2;

  // Mode: region
  if (regionId) {
    where.push(`region_id = $${i++}`);
    args.push(regionId);
  }

  // Mode: radius (only if no regionId)
  if (!regionId && x !== null && z !== null && radius !== null) {
    const safeRadius = Math.max(0, Math.min(radius, 10_000));
    const r2 = safeRadius * safeRadius;

    where.push(`x IS NOT NULL AND z IS NOT NULL`);
    where.push(`((x - $${i}) * (x - $${i}) + (z - $${i + 1}) * (z - $${i + 1})) <= $${i + 2}`);
    args.push(x, z, r2);
    i += 3;
  }

  // Filters
  if (authority) {
    if (authority === "anchor") where.push(`spawn_id LIKE 'anchor:%'`);
    else if (authority === "seed") where.push(`spawn_id LIKE 'seed:%'`);
    else if (authority === "brain") where.push(`spawn_id LIKE 'brain:%'`);
    else {
      // manual = not any of the known prefixes
      where.push(`spawn_id NOT LIKE 'anchor:%' AND spawn_id NOT LIKE 'seed:%' AND spawn_id NOT LIKE 'brain:%'`);
    }
  }

  if (typeQ) {
    where.push(`LOWER(type) = LOWER($${i++})`);
    args.push(typeQ);
  }

  if (archetypeQ) {
    where.push(`LOWER(archetype) = LOWER($${i++})`);
    args.push(archetypeQ);
  }

  if (protoQ) {
    where.push(`proto_id ILIKE $${i++}`);
    args.push(`%${protoQ}%`);
  }

  if (spawnQ) {
    where.push(`spawn_id ILIKE $${i++}`);
    args.push(`%${spawnQ}%`);
  }

  return { whereSql: where.join(" AND "), args };
}

// POST /api/admin/spawn_points/bulk_ownership_query
router.post("/bulk_ownership_query", async (req, res) => {
  try {
    const body: BulkOwnershipQueryRequest = (req.body ?? {}) as any;
    const shardId = strOrNull(body.shardId) ?? strOrNull(body.query?.shardId) ?? "prime_shard";
    const action = String(body.action ?? "").trim().toLowerCase() as BulkOwnershipQueryAction;

    if (!(action === "adopt" || action === "release" || action === "lock" || action === "unlock")) {
      return res.status(400).json({ kind: "spawn_points.bulk_ownership", ok: false, error: "invalid_action" } satisfies BulkOwnershipQueryResponse);
    }

    const q: BulkOwnershipQuery = (body.query ?? {}) as any;
    const { whereSql, args } = buildWhereFromQueryFilters(shardId, q);

    const MAX_ROWS = 5000;
    const rows = await db.query(
      `
      SELECT id, spawn_id, owner_kind, owner_id, is_locked
      FROM spawn_points
      WHERE ${whereSql}
      ORDER BY id ASC
      LIMIT $${args.length + 1}
      `,
      [...args, MAX_ROWS + 1],
    );

    const found = rows.rows ?? [];
    if (found.length > MAX_ROWS) {
      return res.status(413).json({
        kind: "spawn_points.bulk_ownership",
        ok: false,
        action,
        shardId,
        matched: found.length,
        wouldChange: 0,
        skippedReadOnly: 0,
        skippedNoOp: 0,
        error: "too_many_rows",
      } satisfies BulkOwnershipQueryResponse);
    }

    // Determine which rows can be modified. For metadata-only ops we’re lenient, but still keep a readOnly bucket
    // so the UI can explain why certain rows were not touched.
    const isRowEditable = (spawnId: string, ownerKind: string): boolean => {
      const okOwner = String(ownerKind ?? "").trim().toLowerCase() === "editor";
      return okOwner || isSpawnEditable(String(spawnId ?? ""));
    };

    const ownerId = strOrNull(body.ownerId);
    const targetIds: number[] = [];
    const targetSpawnIds: string[] = [];

    const readOnlySpawnIds: string[] = [];
    let noOpCount = 0;

    for (const r of found as any[]) {
      const id = Number(r.id ?? 0);
      const spawnId = String(r.spawn_id ?? "");
      const ownerKind = String(r.owner_kind ?? "");
      const locked = Boolean(r.is_locked);
      if (!Number.isFinite(id) || id <= 0 || !spawnId) continue;

      if (action !== "adopt" && !isRowEditable(spawnId, ownerKind)) {
        readOnlySpawnIds.push(spawnId);
        continue;
      }

      if (action === "adopt") {
        const isAlready = String(ownerKind).trim().toLowerCase() === "editor" && (strOrNull(r.owner_id) ?? null) === ownerId;
        if (isAlready) {
          noOpCount++;
          continue;
        }
      }

      if (action === "release") {
        const isEditor = String(ownerKind).trim().toLowerCase() === "editor";
        if (!isEditor && !strOrNull(r.owner_id)) {
          noOpCount++;
          continue;
        }
      }

      if (action === "lock") {
        if (locked) {
          noOpCount++;
          continue;
        }
      }

      if (action === "unlock") {
        if (!locked) {
          noOpCount++;
          continue;
        }
      }

      targetIds.push(id);
      targetSpawnIds.push(spawnId);
    }

    // Provide a small sample so the UI can show "what exactly will happen" without dumping huge JSON.
    const SAMPLE_LIMIT = 25;
    const sampleRows = (found as any[]).slice(0, SAMPLE_LIMIT).map((r: any) => {
      const spawnId = String(r.spawn_id ?? "");
      const ownerKind = (strOrNull(r.owner_kind) ?? null) as string | null;
      const rowOwnerId = (strOrNull(r.owner_id) ?? null) as string | null;
      const locked = Boolean(r.is_locked);

      const editable = action === "adopt" ? true : isRowEditable(spawnId, ownerKind ?? "");
      if (!editable) {
        return {
          spawnId,
          ownerKind,
          ownerId: rowOwnerId,
          isLocked: locked,
          wouldChange: false,
          reason: "readOnly" as const,
        };
      }

      // Mirror the same no-op checks used above.
      let isNoOp = false;
      if (action === "adopt") {
        isNoOp = String(ownerKind ?? "").trim().toLowerCase() === "editor" && rowOwnerId === ownerId;
      } else if (action === "release") {
        const isEditor = String(ownerKind ?? "").trim().toLowerCase() === "editor";
        isNoOp = !isEditor && !rowOwnerId;
      } else if (action === "lock") {
        isNoOp = locked;
      } else if (action === "unlock") {
        isNoOp = !locked;
      }

      return {
        spawnId,
        ownerKind,
        ownerId: rowOwnerId,
        isLocked: locked,
        wouldChange: !isNoOp,
        reason: isNoOp ? ("noOp" as const) : ("change" as const),
      };
    });

    const PREVIEW_LIMIT = 75;
    const opsPreview: BulkOwnershipOpsPreview = {
      limit: PREVIEW_LIMIT,
      truncated: targetSpawnIds.length > PREVIEW_LIMIT || readOnlySpawnIds.length > PREVIEW_LIMIT,
      changeSpawnIds: targetSpawnIds.slice(0, PREVIEW_LIMIT),
      changeCount: targetSpawnIds.length,
      readOnlySpawnIds: readOnlySpawnIds.slice(0, PREVIEW_LIMIT),
      readOnlyCount: readOnlySpawnIds.length,
      noOpCount,
      sampleRows,
    };

    const commit = Boolean(body.commit);
    const confirm = strOrNull(body.confirm);

    const expectedConfirmToken = targetIds.length > 0 ? makeConfirmToken("REPLACE", shardId, { op: "bulk_ownership", action, whereSql, args, count: targetIds.length }) : null;

    if (commit && expectedConfirmToken && confirm !== expectedConfirmToken) {
      return res.status(409).json({
        kind: "spawn_points.bulk_ownership",
        ok: false,
        action,
        shardId,
        matched: found.length,
        wouldChange: targetIds.length,
        skippedReadOnly: readOnlySpawnIds.length,
        skippedNoOp: noOpCount,
        error: "confirm_required",
        expectedConfirmToken,
        opsPreview,
      } satisfies BulkOwnershipQueryResponse);
    }

    if (!commit) {
      return res.json({
        kind: "spawn_points.bulk_ownership",
        ok: true,
        action,
        shardId,
        matched: found.length,
        wouldChange: targetIds.length,
        skippedReadOnly: readOnlySpawnIds.length,
        skippedNoOp: noOpCount,
        expectedConfirmToken: expectedConfirmToken ?? undefined,
        opsPreview,
      } satisfies BulkOwnershipQueryResponse);
    }

    if (targetIds.length === 0) {
      return res.json({
        kind: "spawn_points.bulk_ownership",
        ok: true,
        action,
        shardId,
        matched: found.length,
        wouldChange: 0,
        skippedReadOnly: readOnlySpawnIds.length,
        skippedNoOp: noOpCount,
        commit: true,
        changed: 0,
        opsPreview,
      } satisfies BulkOwnershipQueryResponse);
    }

    let changed = 0;
    if (action === "adopt") {
      const upd = await db.query(
        `UPDATE spawn_points SET owner_kind='editor', owner_id=$3, updated_at=NOW() WHERE shard_id=$1 AND id = ANY($2::int[])`,
        [shardId, targetIds, ownerId],
      );
      changed = Number(upd.rowCount ?? targetIds.length);
    } else if (action === "release") {
      const upd = await db.query(
        `
        UPDATE spawn_points
        SET
          owner_kind = CASE
            WHEN spawn_id LIKE 'seed:%' THEN 'baseline'
            WHEN spawn_id LIKE 'brain:%' THEN 'brain'
            ELSE NULL
          END,
          owner_id = NULL,
          updated_at = NOW()
        WHERE shard_id=$1 AND id = ANY($2::int[])
        `,
        [shardId, targetIds],
      );
      changed = Number(upd.rowCount ?? targetIds.length);
    } else if (action === "lock") {
      const upd = await db.query(
        `UPDATE spawn_points SET is_locked=TRUE, updated_at=NOW() WHERE shard_id=$1 AND id = ANY($2::int[])`,
        [shardId, targetIds],
      );
      changed = Number(upd.rowCount ?? targetIds.length);
    } else if (action === "unlock") {
      const upd = await db.query(
        `UPDATE spawn_points SET is_locked=FALSE, updated_at=NOW() WHERE shard_id=$1 AND id = ANY($2::int[])`,
        [shardId, targetIds],
      );
      changed = Number(upd.rowCount ?? targetIds.length);
    }

    clearSpawnPointCache();

    return res.json({
      kind: "spawn_points.bulk_ownership",
      ok: true,
      action,
      shardId,
      matched: found.length,
      wouldChange: targetIds.length,
      skippedReadOnly: readOnlySpawnIds.length,
      skippedNoOp: noOpCount,
      commit: true,
      changed,
      opsPreview,
    } satisfies BulkOwnershipQueryResponse);
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] bulk_ownership_query error", err);
    return res.status(500).json({ kind: "spawn_points.bulk_ownership", ok: false, error: "internal_error" } satisfies BulkOwnershipQueryResponse);
  }
});

type BulkDeleteRequest = {
  shardId?: string;
  ids: number[];
};

router.post("/bulk_delete", async (req, res) => {
  try {
    const body: BulkDeleteRequest = (req.body ?? {}) as any;
    const shardId = strOrNull(body.shardId) ?? "prime_shard";
    const ids = Array.isArray(body.ids) ? body.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : [];

    if (ids.length === 0) {
      return res.status(400).json({ ok: false, error: "no_ids" });
    }

    // Enforce readonly at server side (don’t trust UI).
    const rows = await db.query(
      `
      SELECT id, spawn_id, owner_kind, is_locked
      FROM spawn_points
      WHERE shard_id = $1 AND id = ANY($2::int[])
      `,
      [shardId, ids],
    );

    const deletable = (rows.rows ?? [])
      .filter((r: any) => {
        if (Boolean(r.is_locked)) return false;
        const spawnId = String(r.spawn_id ?? "");
        const ownerKind = String(r.owner_kind ?? "").trim().toLowerCase();
        const isEditorOwned = ownerKind === "editor";
        return isEditorOwned || isSpawnEditable(spawnId);
      })
      .map((r: any) => Number(r.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    if (deletable.length === 0) {
      return res.json({ ok: true, deleted: 0, skipped: ids.length });
    }

    const del = await db.query(
      `DELETE FROM spawn_points WHERE shard_id = $1 AND id = ANY($2::int[])`,
      [shardId, deletable],
    );

    clearSpawnPointCache();

    res.json({
      ok: true,
      deleted: Number(del.rowCount ?? deletable.length),
      skipped: ids.length - deletable.length,
    });
  } catch (err) {
    console.error("[ADMIN/SPAWN_POINTS] bulk_delete error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

type BulkMoveRequest = {
  shardId?: string;
  ids: number[];
  dx?: number;
  dy?: number;
  dz?: number;
};

router.post("/bulk_move", async (req, res) => {
  try {
    const body: BulkMoveRequest = (req.body ?? {}) as any;
    const shardId = strOrNull(body.shardId) ?? "prime_shard";

    const ids = Array.isArray(body.ids) ? body.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : [];
    if (ids.length === 0) return res.status(400).json({ ok: false, error: "no_ids" });

    const dx = Number(body.dx ?? 0);
    const dy = Number(body.dy ?? 0);
    const dz = Number(body.dz ?? 0);

    if (![dx, dy, dz].some((n) => Number.isFinite(n) && n !== 0)) {
      return res.status(400).json({ ok: false, error: "no_delta" });
    }

    // Filter out readonly ids (server-side enforcement).
    const rows = await db.query(
      `
      SELECT id, spawn_id, owner_kind, is_locked
      FROM spawn_points
      WHERE shard_id = $1 AND id = ANY($2::int[])
      `,
      [shardId, ids],
    );

    const movable = (rows.rows ?? [])
      .filter((r: any) => !Boolean(r.is_locked))
      .filter((r: any) => {
        const spawnId = String(r.spawn_id ?? "");
        const ownerKind = String(r.owner_kind ?? "").trim().toLowerCase();
        const isEditorOwned = ownerKind === "editor";
        return isEditorOwned || isSpawnEditable(spawnId);
      })
      .map((r: any) => Number(r.id))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    if (movable.length === 0) {
      return res.json({ ok: true, moved: 0, skipped: ids.length });
    }

    // Only move rows with coordinates present (x/z). y is optional.
    // If y is null, we treat it as 0 then add dy, resulting in dy.
    const upd = await db.query(
      `
      UPDATE spawn_points
      SET
        x = CASE WHEN x IS NULL THEN NULL ELSE x + $3 END,
        y = CASE WHEN y IS NULL THEN (CASE WHEN $4 = 0 THEN NULL ELSE $4 END) ELSE y + $4 END,
        z = CASE WHEN z IS NULL THEN NULL ELSE z + $5 END
      WHERE shard_id = $1
        AND id = ANY($2::int[])
      `,
      [shardId, movable, Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? dy : 0, Number.isFinite(dz) ? dz : 0],
    );

    clearSpawnPointCache();

    res.json({
      ok: true,
      moved: Number(upd.rowCount ?? movable.length),
      skipped: ids.length - movable.length,
    });
  } catch (err) {
    console.error("[ADMIN/SPAWN_POINTS] bulk_move error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});



// ------------------------------

// ------------------------------
// System 3: Clone / Scatter (editor paint tools)
// ------------------------------

type CloneRequest = {
  shardId?: string;
  ids: number[];
  countPerId?: number;
  scatterRadius?: number;
  minDistance?: number;
  seedBase?: string;
  regionId?: string | null;
};

type ScatterRequest = {
  shardId?: string;
  type: string;
  archetype: string;
  protoId?: string | null;
  variantId?: string | null;
  count?: number;
  centerX?: number;
  centerZ?: number;
  y?: number;
  regionId?: string | null;
  townTier?: number | null;
  scatterRadius?: number;
  minDistance?: number;
  seedBase?: string;
};

function finiteOr(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function sampleDisk(centerX: number, centerZ: number, radius: number): { x: number; z: number } {
  const r = Math.max(0, radius);
  if (r === 0) return { x: centerX, z: centerZ };
  const t = Math.random() * Math.PI * 2;
  const u = Math.random();
  const rr = Math.sqrt(u) * r;
  return { x: centerX + Math.cos(t) * rr, z: centerZ + Math.sin(t) * rr };
}

function randSuffix(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function normalizeSeedBase(v: any): string {
  const s = String(v ?? "").trim();
  if (!s) return "seed:editor";
  return s;
}

function getActorIdFromReq(req: any): string | null {
  const sub = String(req?.auth?.sub ?? "").trim();
  return sub ? sub : null;
}

function ownerKindForSeedBase(seedBase: string): SpawnOwnerKind {
  const lower = String(seedBase || "").trim().toLowerCase();
  // Editor paint tools should always mark their outputs as editor-owned.
  // We keep this function in case we later add controlled non-editor seeds.
  if (lower.startsWith("seed:")) return "editor";
  return "editor";
}

function makeSpawnId(seedBase: string, kind: "clone" | "scatter", hint: string): string {
  const safeHint = String(hint ?? "x")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9:_\-\.]/g, "");
  const base = normalizeSeedBase(seedBase);

  // Never allow brain:* writes from the editor endpoints.
  if (base.toLowerCase().startsWith("brain:")) {
    throw new Error("seedBase cannot be brain:* (brain spawns are read-only)");
  }

  const stamp = Date.now().toString(36);
  return `${base}:${kind}:${safeHint}:${stamp}:${randSuffix(6)}`;
}

async function loadNearbyPointsForSpacing(params: {
  shardId: string;
  regionId: string | null;
  centerX: number;
  centerZ: number;
  radius: number;
}): Promise<Array<{ x: number; z: number }>> {
  const { shardId, regionId, centerX, centerZ, radius } = params;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ) || radius <= 0) return [];

  // Fast prefilter: bounding box.
  const minX = centerX - radius;
  const maxX = centerX + radius;
  const minZ = centerZ - radius;
  const maxZ = centerZ + radius;

  const args: any[] = [shardId, minX, maxX, minZ, maxZ];
  let sql = `
    SELECT x, z
    FROM spawn_points
    WHERE shard_id = $1
      AND x IS NOT NULL AND z IS NOT NULL
      AND x BETWEEN $2 AND $3
      AND z BETWEEN $4 AND $5
  `;

  if (regionId) {
    sql += ` AND region_id = $6`;
    args.push(regionId);
  }

  const rows = await db.query(sql, args);
  return (rows.rows ?? [])
    .map((r: any) => ({ x: Number(r.x), z: Number(r.z) }))
    .filter((p: { x: number; z: number }) => Number.isFinite(p.x) && Number.isFinite(p.z));
}

function pickPositionWithSpacing(params: {
  centerX: number;
  centerZ: number;
  scatterRadius: number;
  minDistance: number;
  existing: Array<{ x: number; z: number }>;
  placed: Array<{ x: number; z: number }>;
}): { x: number; z: number } | null {
  const { centerX, centerZ, scatterRadius, minDistance, existing, placed } = params;
  const minD = Math.max(0, minDistance);
  const minD2 = minD * minD;

  // If spacing is disabled, first roll wins.
  if (minD === 0) return sampleDisk(centerX, centerZ, scatterRadius);

  const tries = 80;
  for (let t = 0; t < tries; t++) {
    const p = sampleDisk(centerX, centerZ, scatterRadius);

    // check against existing + newly placed
    let ok = true;
    for (const q of existing) {
      if (dist2(p.x, p.z, q.x, q.z) < minD2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const q of placed) {
      if (dist2(p.x, p.z, q.x, q.z) < minD2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    return p;
  }

  return null;
}

// POST /api/admin/spawn_points/clone
// Body: { shardId, ids, countPerId, scatterRadius, minDistance, seedBase, regionId? }
router.post("/clone", async (req, res) => {
  const body: CloneRequest = (req.body ?? {}) as any;

  try {
    const shardId = strOrNull(body.shardId) ?? "prime_shard";
    const actorId = getActorIdFromReq(req);
    const ids = Array.isArray(body.ids)
      ? body.ids
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];

    if (ids.length === 0) {
      return res.status(400).json(cloneScatterFail("no_ids") satisfies CloneScatterResponse);
    }

    const countPerId = clamp(finiteOr(body.countPerId, 1), 1, 500);
    const scatterRadius = clamp(finiteOr(body.scatterRadius, 0), 0, 50_000);
    const minDistance = clamp(finiteOr(body.minDistance, 0), 0, 50_000);
    const seedBase = normalizeSeedBase(body.seedBase);
    const regionOverride = strOrNull(body.regionId);

    // Load source rows.
    const rows = await db.query(
      `
      SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier,
             owner_kind, owner_id, is_locked
      FROM spawn_points
      WHERE shard_id = $1 AND id = ANY($2::int[])
      `,
      [shardId, ids],
    );

    const source = (rows.rows ?? []).map(mapRowToAdmin);
    if (source.length === 0) {
      return res.status(404).json(cloneScatterFail("not_found") satisfies CloneScatterResponse);
    }

    let skippedBrainOwned = 0;
    let skippedMissingCoords = 0;
    let failedToPlace = 0;
    let inserted = 0;
    const createdIds: number[] = [];
    const createdSpawnIds: string[] = [];

    for (const sp of source) {
      // Brain authority spawns are normally read-only. However, if a spawn has been
      // explicitly adopted (ownerKind=editor), allow editor tools to operate on it.
      if (!isSpawnEditable(sp.spawnId) && sp.ownerKind !== "editor") {
        skippedBrainOwned += 1;
        continue;
      }

      const baseX = numOrNull(sp.x);
      const baseZ = numOrNull(sp.z);
      const baseY = numOrNull(sp.y) ?? 0;

      if (baseX === null || baseZ === null) {
        skippedMissingCoords += 1;
        continue;
      }

      const targetRegionId = regionOverride ?? strOrNull(sp.regionId);

      const spacingRadius = Math.max(scatterRadius, minDistance);
      const existing = await loadNearbyPointsForSpacing({
        shardId,
        regionId: targetRegionId,
        centerX: baseX,
        centerZ: baseZ,
        radius: spacingRadius,
      });

      const placed: Array<{ x: number; z: number }> = [];

      for (let c = 0; c < countPerId; c++) {
        const p = pickPositionWithSpacing({
          centerX: baseX,
          centerZ: baseZ,
          scatterRadius,
          minDistance,
          existing,
          placed,
        });

        if (!p) {
          failedToPlace += 1;
          continue;
        }

        const spawnId = makeSpawnId(seedBase, "clone", sp.spawnId);
        const ins = await db.query(
          `
          INSERT INTO spawn_points
            (
              shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier,
              owner_kind, owner_id, is_locked,
              source_kind, source_id, source_rev,
              updated_at
            )
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
          RETURNING id
          `,
          [
            shardId,
            spawnId,
            sp.type,
            sp.archetype,
            strOrNull(sp.protoId),
            strOrNull(sp.variantId),
            p.x,
            baseY,
            p.z,
            targetRegionId,
            numOrNull(sp.townTier),
            ownerKindForSeedBase(seedBase),
            actorId,
            false,
            "editor",
            "paint_tools.clone",
            null,
          ],
        );

        const newId = Number(ins.rows?.[0]?.id ?? 0);
        if (Number.isFinite(newId) && newId > 0) createdIds.push(newId);
        createdSpawnIds.push(spawnId);
        inserted += 1;
        placed.push(p);
      }
    }

    clearSpawnPointCache();

    return res.json({
      ok: true,
      inserted,
      skippedBrainOwned,
      skippedMissingCoords,
      failedToPlace,
      createdIds,
      createdSpawnIds,
    } satisfies CloneScatterResponse);
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] clone error", err);
    return res.status(500).json({
      ok: false,
      inserted: 0,
      skippedBrainOwned: 0,
      skippedMissingCoords: 0,
      failedToPlace: 0,
      createdIds: [],
      createdSpawnIds: [],
      error: err?.message || "internal_error",
    } satisfies CloneScatterResponse);
  }
});

// POST /api/admin/spawn_points/scatter
// Body: { shardId, type, archetype, protoId?, variantId?, count, centerX, centerZ, y, regionId?, townTier?, scatterRadius, minDistance, seedBase }
router.post("/scatter", async (req, res) => {
  const body: ScatterRequest = (req.body ?? {}) as any;

  try {
    const shardId = strOrNull(body.shardId) ?? "prime_shard";
    const actorId = getActorIdFromReq(req);

    const type = requiredStr(body.type);
    const archetype = requiredStr(body.archetype);
    const protoId = strOrNull(body.protoId);
    const variantId = strOrNull(body.variantId);

    const count = clamp(finiteOr(body.count, 1), 1, 5000);
    const centerX = finiteOr(body.centerX, 0);
    const centerZ = finiteOr(body.centerZ, 0);
    const y = finiteOr(body.y, 0);
    const regionId = strOrNull(body.regionId);
    const townTier = numOrNull(body.townTier);

    const scatterRadius = clamp(finiteOr(body.scatterRadius, 0), 0, 50_000);
    const minDistance = clamp(finiteOr(body.minDistance, 0), 0, 50_000);
    const seedBase = normalizeSeedBase(body.seedBase);

    // protoId rules: if it's npc/node/resource-ish, require protoId.
    const t = type.toLowerCase();
    if (
      (t === "npc" || t === "mob" || t === "creature" || t === "node" || t === "resource") &&
      !protoId
    ) {
      return res
        .status(400)
        .json(
          cloneScatterFail("protoId_required_for_npc_node_resource") satisfies CloneScatterResponse,
        );
    }

    // Spacing checks need existing points in the area.
    const spacingRadius = Math.max(scatterRadius, minDistance);
    const existing = await loadNearbyPointsForSpacing({
      shardId,
      regionId,
      centerX,
      centerZ,
      radius: spacingRadius,
    });

    const placed: Array<{ x: number; z: number }> = [];

    let inserted = 0;
    let failedToPlace = 0;

    const createdIds: number[] = [];
    const createdSpawnIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const p = pickPositionWithSpacing({
        centerX,
        centerZ,
        scatterRadius,
        minDistance,
        existing,
        placed,
      });

      if (!p) {
        failedToPlace += 1;
        continue;
      }

      const spawnId = makeSpawnId(seedBase, "scatter", protoId || archetype || type);
      const ins = await db.query(
        `
        INSERT INTO spawn_points
          (
            shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier,
            owner_kind, owner_id, is_locked,
            source_kind, source_id, source_rev,
            updated_at
          )
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
        RETURNING id
        `,
        [
          shardId,
          spawnId,
          type,
          archetype,
          protoId,
          variantId,
          p.x,
          y,
          p.z,
          regionId,
          townTier,
          ownerKindForSeedBase(seedBase),
          actorId,
          false,
          "editor",
          "paint_tools.scatter",
          null,
        ],
      );

      const newId = Number(ins.rows?.[0]?.id ?? 0);
      if (Number.isFinite(newId) && newId > 0) createdIds.push(newId);
      createdSpawnIds.push(spawnId);
      inserted += 1;
      placed.push(p);
    }

    clearSpawnPointCache();

    return res.json({
      ok: true,
      inserted,
      skippedBrainOwned: 0,
      skippedMissingCoords: 0,
      failedToPlace,
      createdIds,
      createdSpawnIds,
    } satisfies CloneScatterResponse);
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] scatter error", err);
    return res.status(500).json({
      ok: false,
      inserted: 0,
      skippedBrainOwned: 0,
      skippedMissingCoords: 0,
      failedToPlace: 0,
      createdIds: [],
      createdSpawnIds: [],
      error: err?.message || "internal_error",
    } satisfies CloneScatterResponse);
  }
});


// Town Baseline seeding endpoints (Placement Editor MVP)
// -----------------------------------------------------

type TownBaselinePlanRequest = {
  shardId?: string;
  townSpawn?: AdminSpawnPoint;
  townSpawnId?: number;

  // Optional override bounds/cell size.
  // bounds format: "-8..8,-8..8" in cell coords.
  bounds?: string;
  cellSize?: number;

  // Seed behavior
  spawnIdMode?: "seed" | "legacy";
  seedBase?: string;

  // What to include
  includeMailbox?: boolean;
  includeRest?: boolean;
  includeStations?: boolean;
  includeGuards?: boolean;
  includeDummies?: boolean;

  guardCount?: number;
  dummyCount?: number;
  stationProtoIds?: string[];
  respectTownTierStations?: boolean;

  // Optional: override town tier for station gating
  townTierOverride?: number | null;
};

type TownBaselinePlanItem = {
  spawn: AdminSpawnPoint;
  op: "insert" | "update" | "skip";
  existingId?: number | null;
};

type TownBaselinePlanResponse = {
  kind?: AdminApiKind;
  summary?: AdminSummary;
  ok: boolean;

  // request echo (useful for audits / UI confirm flows)
  shardId?: string;
  bounds?: string;
  cellSize?: number;
  borderMargin?: number;
  seedBase: string;
  spawnIdMode: "seed" | "legacy";
  includeStations: boolean;
  respectTownTierStations: boolean;
  townTierOverride: number | null;

  wouldInsert?: number;
  wouldUpdate?: number;
  wouldSkip?: number;
  skippedReadOnly?: number;
  skippedProtected?: number;

  opsPreview?: TownBaselineOpsPreview;

  plan?: TownBaselinePlanItem[];
  error?: string;
};

function cellBoundsAroundWorldPoint(x: number, z: number, cellSize: number, marginCells: number): CellBounds {
  const cs = Math.max(1, Math.floor(cellSize || 64));
  const cx = Math.floor(x / cs);
  const cz = Math.floor(z / cs);
  const m = Math.max(1, Math.floor(marginCells || 1));
  return { minCx: cx - m, maxCx: cx + m, minCz: cz - m, maxCz: cz + m };
}

function cellBoundsToString(b: CellBounds): string {
  return `${b.minCx}..${b.maxCx},${b.minCz}..${b.maxCz}`;
}

function approxEq(a: number | null, b: number | null, eps = 1e-6): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) <= eps;
}

function sameSpawnRow(existing: any, planned: AdminSpawnPoint): boolean {
  // Compare the columns we write in apply.
  const exType = String(existing.type ?? "");
  const exArch = String(existing.archetype ?? "");
  const exProto = strOrNull(existing.proto_id);
  const exVar = strOrNull(existing.variant_id);
  const exRegion = strOrNull(existing.region_id);
  const exTier = numOrNull(existing.town_tier);

  const exX = numOrNull(existing.x);
  const exY = numOrNull(existing.y);
  const exZ = numOrNull(existing.z);

  return (
    exType === planned.type &&
    exArch === planned.archetype &&
    exProto === strOrNull(planned.protoId) &&
    exVar === strOrNull(planned.variantId) &&
    exRegion === strOrNull(planned.regionId) &&
    (exTier ?? null) === (numOrNull(planned.townTier) ?? null) &&
    approxEq(exX, numOrNull(planned.x)) &&
    approxEq(exY, numOrNull(planned.y)) &&
    approxEq(exZ, numOrNull(planned.z))
  );
}

async function loadTownSpawnFromDb(shardId: string, id: number): Promise<AdminSpawnPoint | null> {
  const res = await db.query(
    `
    SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier
    FROM spawn_points
    WHERE shard_id = $1 AND id = $2
    LIMIT 1
    `,
    [shardId, id],
  );

  const row = res.rows?.[0];
  return row ? mapRowToAdmin(row) : null;
}

function toTownLikeRow(sp: AdminSpawnPoint, townTierOverride: number | null): TownLikeSpawnRow {
  const x = numOrNull(sp.x);
  const y = numOrNull(sp.y) ?? 0;
  const z = numOrNull(sp.z);
  if (x === null || z === null) {
    throw new Error("townSpawn must have numeric x and z");
  }

  return {
    shardId: requiredStr(sp.shardId),
    spawnId: requiredStr(sp.spawnId),
    type: requiredStr(sp.type),
    archetype: requiredStr(sp.archetype),
    protoId: strOrUndef(sp.protoId),
    variantId: strOrNull(sp.variantId),
    x,
    y,
    z,
    regionId: strOrNull(sp.regionId),
    townTier: townTierOverride != null ? townTierOverride : numOrNull(sp.townTier),
  };
}

async function computeTownBaselinePlan(body: TownBaselinePlanRequest): Promise<{
  shardId: string;
  bounds: string;
  cellSize: number;
  seedBase: string;
  spawnIdMode: "seed" | "legacy";
  includeStations: boolean;
  respectTownTierStations: boolean;
  townTierOverride: number | null;
  planItems: TownBaselinePlanItem[];
  wouldInsert: number;
  wouldUpdate: number;
  wouldSkip: number;
  skippedProtected: number;
}> {
  const shardId = strOrNull(body.shardId) ?? "prime_shard";
  const cellSize = Number.isFinite(Number(body.cellSize)) ? Number(body.cellSize) : 64;

  let townSpawn: AdminSpawnPoint | null = null;
  if (body.townSpawn) {
    townSpawn = body.townSpawn as any;
  } else if (Number.isFinite(Number(body.townSpawnId))) {
    townSpawn = await loadTownSpawnFromDb(shardId, Number(body.townSpawnId));
  }

  if (!townSpawn) {
    throw new Error("townSpawn (or townSpawnId) is required");
  }

  // Ensure shardId is consistent.
  townSpawn.shardId = townSpawn.shardId?.trim() || shardId;

  const x = numOrNull(townSpawn.x);
  const z = numOrNull(townSpawn.z);
  if (x === null || z === null) {
    throw new Error("Selected town spawn must have x and z coords");
  }

  const townTierOverride = body.townTierOverride != null ? numOrNull(body.townTierOverride) : null;

  // Default bounds: around the selected town. (Big enough for radius-based placements.)
  const defaultBounds = cellBoundsAroundWorldPoint(x, z, cellSize, 6);
  const boundsStr = strOrNull(body.bounds) ?? cellBoundsToString(defaultBounds);

  const parsedBounds = parseCellBounds(boundsStr);

  const spawnIdMode = body.spawnIdMode === "legacy" ? "legacy" : "seed";
  const seedBase = normalizeSeedBase(body.seedBase);

  const includeMailbox = body.includeMailbox !== false;
  const includeRest = body.includeRest !== false;
  const includeStations = body.includeStations === true;
  const includeGuards = body.includeGuards !== false;
  const includeDummies = body.includeDummies !== false;

  const guardCount = includeGuards ? clamp(finiteOr(body.guardCount, 2), 0, 50) : 0;
  const dummyCount = includeDummies ? clamp(finiteOr(body.dummyCount, 1), 0, 50) : 0;

  const stationProtoIds = Array.isArray(body.stationProtoIds) && body.stationProtoIds.length
    ? body.stationProtoIds.map((s) => String(s)).filter(Boolean)
    : getStationProtoIdsForTier(5);

  const respectTownTierStations = body.respectTownTierStations === true;

  const row = toTownLikeRow(townSpawn, townTierOverride);

  const opts: TownBaselinePlanOptions = {
    bounds: parsedBounds,
    cellSize,
    townTypes: ["town", "outpost"],
    spawnIdMode,
    seedBase,
    seedMailbox: includeMailbox,
    seedRest: includeRest,
    seedStations: includeStations,
    stationProtoIds,
    respectTownTierStations,
    guardCount,
    dummyCount,
  };

  const plan = planTownBaselines([row], opts);
  const actions = plan.actions;
  const plannedSpawns: AdminSpawnPoint[] = actions.map((a) => {
    const s = (a as any).spawn ?? (a as any).spawnPoint ?? null;
    if (!s) throw new Error("Planner returned an action without spawn");
    return {
      id: 0,
      shardId: shardId,
      spawnId: String(s.spawnId ?? ""),
      type: String(s.type ?? ""),
      archetype: String(s.archetype ?? ""),
      protoId: strOrNull(s.protoId),
      variantId: strOrNull(s.variantId),
      x: numOrNull(s.x),
      y: numOrNull(s.y),
      z: numOrNull(s.z),
      regionId: strOrNull(s.regionId),
      townTier: numOrNull((s as any).townTier),
      authority: getSpawnAuthority(String(s.spawnId ?? "")),
    };
  });

  // Load existing rows by spawn_id so we can classify insert/update/skip.
  const spawnIds = plannedSpawns.map((p) => p.spawnId).filter(Boolean);
  const existingRes = spawnIds.length
    ? await db.query(
        `
        SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier, owner_kind, owner_id, is_locked
        FROM spawn_points
        WHERE shard_id = $1 AND spawn_id = ANY($2::text[])
        `,
        [shardId, spawnIds],
      )
    : { rows: [] };

  const existingBySpawnId = new Map<string, any>();
  for (const r of existingRes.rows ?? []) {
    existingBySpawnId.set(String(r.spawn_id), r);
  }

  let wouldInsert = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;
  let wouldProtected = 0;

  const planItems: TownBaselinePlanItem[] = plannedSpawns.map((sp) => {
    const ex = existingBySpawnId.get(sp.spawnId);
    if (!ex) {
      wouldInsert += 1;
      return { spawn: sp, op: "insert" };
    }

    // Carry ownership metadata forward for preview/UI logic.
    sp.ownerKind = (ex.owner_kind ?? null) as any;
    sp.ownerId = (ex.owner_id ?? null) as any;
    sp.isLocked = (ex.is_locked ?? null) as any;

    if (sameSpawnRow(ex, sp)) {
      wouldSkip += 1;
      return { spawn: sp, op: "skip", existingId: Number(ex.id) || null };
    }

    wouldUpdate += 1;
    if (sp.ownerKind === "editor" || Boolean(sp.isLocked)) {
      wouldProtected += 1;
    }
    return { spawn: sp, op: "update", existingId: Number(ex.id) || null };
  });

  return {
    shardId,
    bounds: boundsStr,
    cellSize,
    seedBase,
    spawnIdMode,
    includeStations,
    respectTownTierStations,
    townTierOverride,
    planItems,
    wouldInsert,
    wouldUpdate,
    wouldSkip,
    skippedProtected: wouldProtected,
  };
}

// POST /api/admin/spawn_points/town_baseline/plan
// Body: TownBaselinePlanRequest
router.post("/town_baseline/plan", async (req, res) => {
  const body: TownBaselinePlanRequest = (req.body ?? {}) as any;

  try {
    const plan = await computeTownBaselinePlan(body);

    const allPlannedSpawns = plan.planItems.map((p) => p.spawn);
    const response: TownBaselinePlanResponse = {
      kind: "town_baseline.plan",
      summary: summarizePlannedSpawns(allPlannedSpawns),
      ok: true,
      shardId: plan.shardId,
      bounds: plan.bounds,
      cellSize: plan.cellSize,
      seedBase: plan.seedBase,
      spawnIdMode: plan.spawnIdMode,
      includeStations: plan.includeStations,
      respectTownTierStations: plan.respectTownTierStations,
      townTierOverride: plan.townTierOverride,
      wouldInsert: plan.wouldInsert,
      wouldUpdate: plan.wouldUpdate,
      wouldSkip: plan.wouldSkip,
      skippedProtected: (plan).skippedProtected ?? 0,
            opsPreview: buildTownBaselineOpsPreview(plan.planItems),
      plan: plan.planItems,
    };

    return res.json(response);
  } catch (err: any) {
    const shardId = strOrNull(body.shardId) ?? "prime_shard";
    const response: TownBaselinePlanResponse = {
      ok: false,
      shardId,
      bounds: strOrNull(body.bounds) ?? "",
      cellSize: Number.isFinite(Number(body.cellSize)) ? Number(body.cellSize) : 64,
      seedBase: normalizeSeedBase(body.seedBase),
      spawnIdMode: body.spawnIdMode === "legacy" ? "legacy" : "seed",
      includeStations: body.includeStations === true,
      respectTownTierStations: body.respectTownTierStations === true,
      townTierOverride: body.townTierOverride != null ? numOrNull(body.townTierOverride) : null,
      error: String(err?.message ?? "internal_error"),
    };

    return res.status(400).json(response);
  }
});

// POST /api/admin/spawn_points/town_baseline/apply
// Body: TownBaselinePlanRequest & { commit?: boolean }
router.post("/town_baseline/apply", async (req, res) => {
  const body: TownBaselinePlanRequest & { commit?: boolean } = (req.body ?? {}) as any;

  const commit = body.commit === true;

  try {
    const plan = await computeTownBaselinePlan(body);

    if (!commit) {
      const allPlannedSpawns = plan.planItems.map((p) => p.spawn);

      const response: TownBaselinePlanResponse = {
        kind: "town_baseline.apply",
        summary: summarizePlannedSpawns(allPlannedSpawns),
        ok: true,
        shardId: plan.shardId,
        bounds: plan.bounds,
        cellSize: plan.cellSize,
        seedBase: plan.seedBase,
        spawnIdMode: plan.spawnIdMode,
        includeStations: plan.includeStations,
        respectTownTierStations: plan.respectTownTierStations,
        townTierOverride: plan.townTierOverride,
        wouldInsert: plan.wouldInsert,
        wouldUpdate: plan.wouldUpdate,
        wouldSkip: plan.wouldSkip,
        skippedProtected: (plan).skippedProtected ?? 0,
              opsPreview: buildTownBaselineOpsPreview(plan.planItems),
      plan: plan.planItems,
      };
      return res.json(response);
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let skippedReadOnly = 0;
    let skippedProtected = 0;

    await db.query("BEGIN");
    try {
      for (const item of plan.planItems) {
        const sp = item.spawn;
        const sid = String(sp.spawnId ?? "");

        // Safety: never mutate brain-owned points.
        if (!isSpawnEditable(sid)) {
          skippedReadOnly += 1;
          continue;
        }

        // Lock existing row by spawnId.
        const lockRes = await db.query(
          `
          SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier, owner_kind, owner_id, is_locked
          FROM spawn_points
          WHERE shard_id = $1 AND spawn_id = $2
          LIMIT 1
          FOR UPDATE
          `,
          [plan.shardId, sid],
        );

        const ex = lockRes.rows?.[0];
        if (!ex) {
          await db.query(
            `
            INSERT INTO spawn_points
              (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier, owner_kind, source_kind, source_id)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            `,
            [
              plan.shardId,
              sid,
              sp.type,
              sp.archetype,
              strOrNull(sp.protoId),
              strOrNull(sp.variantId),
              numOrNull(sp.x),
              numOrNull(sp.y) ?? 0,
              numOrNull(sp.z),
              strOrNull(sp.regionId),
              numOrNull(sp.townTier),
              "baseline",
              "town_baseline",
              "planner",
            ],
          );
          inserted += 1;
          continue;
        }

        if (String(ex.owner_kind ?? "") === "editor" || Boolean(ex.is_locked)) {
          skippedProtected += 1;
          continue;
        }

        if (sameSpawnRow(ex, sp)) {
          skipped += 1;
          continue;
        }

        await db.query(
          `
          UPDATE spawn_points
          SET type = $3,
              archetype = $4,
              proto_id = $5,
              variant_id = $6,
              x = $7,
              y = $8,
              z = $9,
              region_id = $10,
              town_tier = $11
          WHERE shard_id = $1 AND id = $2
          `,
          [
            plan.shardId,
            Number(ex.id),
            sp.type,
            sp.archetype,
            strOrNull(sp.protoId),
            strOrNull(sp.variantId),
            numOrNull(sp.x),
            numOrNull(sp.y) ?? 0,
            numOrNull(sp.z),
            strOrNull(sp.regionId),
            numOrNull(sp.townTier),
          ],
        );
        updated += 1;
      }

      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }

    clearSpawnPointCache();

    const allPlannedSpawns = plan.planItems.map((p) => p.spawn);
    const response: TownBaselinePlanResponse = {
      kind: "town_baseline.apply",
      summary: summarizePlannedSpawns(allPlannedSpawns),
      ok: true,
      shardId: plan.shardId,
      bounds: plan.bounds,
      cellSize: plan.cellSize,
      seedBase: plan.seedBase,
      spawnIdMode: plan.spawnIdMode,
      includeStations: plan.includeStations,
      respectTownTierStations: plan.respectTownTierStations,
      townTierOverride: plan.townTierOverride,
      wouldInsert: inserted,
      wouldUpdate: updated,
      wouldSkip: skipped,
      skippedReadOnly,
      skippedProtected,
            opsPreview: buildTownBaselineOpsPreview(plan.planItems),
      plan: plan.planItems,
    };

    return res.json(response);
  } catch (err: any) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // ignore
    }

    const shardId = strOrNull(body.shardId) ?? "prime_shard";
    const response: TownBaselinePlanResponse = {
      ok: false,
      shardId,
      bounds: strOrNull(body.bounds) ?? "",
      cellSize: Number.isFinite(Number(body.cellSize)) ? Number(body.cellSize) : 64,
      seedBase: normalizeSeedBase(body.seedBase),
      spawnIdMode: body.spawnIdMode === "legacy" ? "legacy" : "seed",
      includeStations: body.includeStations === true,
      respectTownTierStations: body.respectTownTierStations === true,
      townTierOverride: body.townTierOverride != null ? numOrNull(body.townTierOverride) : null,
      error: String(err?.message ?? "internal_error"),
    };

    return res.status(500).json(response);
  }
});

// Mother Brain façade endpoints
// ------------------------------

type CellBounds = { minCx: number; maxCx: number; minCz: number; maxCz: number };

type WorldBox = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type MotherBrainListRow = {
  spawnId: string;
  type: string;
  protoId: string | null;
  regionId: string | null;
  protected?: boolean;
};

// Diff/preview payload for UI (kept small; lists are truncated server-side).
type MotherBrainOpsPreview = {
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
};

type TownBaselineOpsPreview = {
  limit: number;
  truncated: boolean;
  insertSpawnIds?: string[];
  updateSpawnIds?: string[];
  skipSpawnIds?: string[];
  readOnlySpawnIds?: string[];
  protectedUpdateSpawnIds?: string[];
};


type MotherBrainStatusResponse = {
  kind?: AdminApiKind;
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


type MotherBrainWaveBudgetConfig = {
  maxTotalInBounds?: number | null;
  maxThemeInBounds?: number | null;
  maxEpochThemeInBounds?: number | null;
  maxNewInserts?: number | null;
};

type MotherBrainWaveRequest = {
  shardId: string;
  bounds: string;
  cellSize: number;

  // NOTE: borderMargin is CELLS padding for selection/deletion boxes.
  borderMargin?: number;

  // Placement inset in WORLD units within each cell (keeps placements off exact edges).
  placeInset?: number;

  seed: string;
  epoch: number;
  theme: string;
  count: number;
  append?: boolean;

  // If true, update existing spawn_id rows in-place; otherwise skip them.
  updateExisting?: boolean;

  // Hardening caps (server applies safe defaults; pass <=0 or null to disable a cap).
  budget?: MotherBrainWaveBudgetConfig;

  commit?: boolean;
  confirm?: string;
};

type MotherBrainWaveResponse = {
  kind?: AdminApiKind;
  summary?: AdminSummary;
  ok: boolean;

  // request echo (useful for UI confirmation prompts)
  shardId?: string;
  bounds?: string;
  cellSize?: number;
  borderMargin?: number;


  // dry-run (commit=false)
  wouldDelete?: number;
  wouldInsert?: number;
  wouldUpdate?: number;
  wouldSkip?: number;
  duplicatePlanned?: number;
  droppedDueToBudget?: number;

  // commit=true
  deleted?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;

  // bookkeeping
  theme?: string;
  epoch?: number;
  append?: boolean;
  budget?: MotherBrainWaveBudgetConfig;
  budgetReport?: any;
  budgetFilter?: any;
  applyPlan?: any;

  // diff/preview lists (truncated)
  opsPreview?: MotherBrainOpsPreview;

  // confirm-token safety (when commit would delete rows)
  expectedConfirmToken?: string;
  error?: string;
};



type MotherBrainWipeRequest = {
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

type MotherBrainWipeResponse = {
  kind?: AdminApiKind;
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

  // diff/preview lists (truncated)
  opsPreview?: MotherBrainOpsPreview;

  // confirm-token safety (when commit would delete rows)
  expectedConfirmToken?: string;
  error?: string;
};

function parseCellBounds(bounds: string): CellBounds {
  // Format: "-1..1,-1..1" (xRange,zRange) in cell coordinates.
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

function toWorldBox(cellBounds: CellBounds, cellSize: number, borderMargin: number): WorldBox {
  // Convert a cell bounds box into a world-space "selection" box.
  // Matches the sim tooling convention: max edge is (max+1)*cellSize.
  const minX = (cellBounds.minCx - borderMargin) * cellSize;
  const maxX = (cellBounds.maxCx + 1 + borderMargin) * cellSize;
  const minZ = (cellBounds.minCz - borderMargin) * cellSize;
  const maxZ = (cellBounds.maxCz + 1 + borderMargin) * cellSize;
  return { minX, maxX, minZ, maxZ };
}

function isBrainSpawnId(spawnId: string): boolean {
  return spawnId.startsWith("brain:");
}

function parseBrainSpawnId(spawnId: string): { epoch: number | null; theme: string | null } {
  // We *prefer* the canonical format:
  //   brain:<epoch>:<theme>:...
  // ...but older/experimental branches sometimes emitted:
  //   brain:<theme>:<epoch>:...
  // or even:
  //   brain:<theme>:...
  const parts = spawnId.split(":");
  if (parts.length < 2) return { epoch: null, theme: null };

  const a = parts[1] ?? null;
  const b = parts[2] ?? null;

  const epochA = Number(a);
  if (Number.isFinite(epochA)) {
    return { epoch: epochA, theme: b };
  }

  const epochB = Number(b);
  if (Number.isFinite(epochB)) {
    return { epoch: epochB, theme: a };
  }

  // Fall back: brain:<theme>:...
  return { epoch: null, theme: a };
}

// ------------------------------
// Snapshot / Restore spawn slices (admin UX)
// ------------------------------

// POST /api/admin/spawn_points/snapshot
// Body:
//   shardId, bounds ("-1..1,-1..1"), cellSize, pad, types[]
async function computeSpawnSliceSnapshot(args: {
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

  const client = await db.connect();
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

router.post("/snapshot", async (req, res) => {
  try {
    const shardId = strOrNull(req.body?.shardId) ?? "prime_shard";
    const boundsRaw = strOrNull(req.body?.bounds);
    if (!boundsRaw) return res.status(400).json({ kind: "spawn_points.snapshot", ok: false, error: "missing_bounds" });

    const types = Array.isArray(req.body?.types) ? (req.body.types as any[]).map((t) => String(t)).filter(Boolean) : [];
    if (!types.length) return res.status(400).json({ kind: "spawn_points.snapshot", ok: false, error: "missing_types" });

    const cellSize = Math.max(1, Number(req.body?.cellSize) || 512);
    const pad = Math.max(0, Number(req.body?.pad) || 0);

    const { snapshot, filename } = await computeSpawnSliceSnapshot({ shardId, boundsRaw, cellSize, pad, types });

    return res.json({ kind: "spawn_points.snapshot", ok: true, filename, snapshot });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] snapshot error", err);
    return res.status(500).json({ kind: "spawn_points.snapshot", ok: false, error: err.message || String(err) });
  }
});





// POST /api/admin/spawn_points/snapshot_query
// Snapshot rows based on the same filters as list endpoint (region OR radius + filters).
router.post("/snapshot_query", async (req, res) => {
  try {
    const shardId = String(req.body?.shardId ?? "prime_shard").trim();

    const regionId = strOrNull(req.body?.regionId);
    const x = numOrNull(req.body?.x);
    const z = numOrNull(req.body?.z);
    const radius = numOrNull(req.body?.radius);

    const authority = normalizeAuthority(req.body?.authority);
    const typeQ = strOrNull(req.body?.type);
    const archetypeQ = strOrNull(req.body?.archetype);
    const protoQ = strOrNull(req.body?.protoId);
    const spawnQ = strOrNull(req.body?.spawnId);

    const cellSize = Math.max(1, Math.min(1024, Number(req.body?.cellSize ?? 64)));
    const pad = Math.max(0, Math.min(1000, Number(req.body?.pad ?? 0)));

    // Hard cap: snapshots by query are for operator workflows, not data exfiltration.
    const MAX_ROWS = 5000;

    const where: string[] = ["shard_id = $1"];
    const args: any[] = [shardId];
    let i = 2;

    if (regionId) {
      where.push(`region_id = $${i++}`);
      args.push(regionId);
    }

    if (!regionId && x !== null && z !== null && radius !== null) {
      const safeRadius = Math.max(0, Math.min(radius, 10_000));
      const r2 = safeRadius * safeRadius;

      where.push(`x IS NOT NULL AND z IS NOT NULL`);
      where.push(`((x - $${i}) * (x - $${i}) + (z - $${i + 1}) * (z - $${i + 1})) <= $${i + 2}`);
      args.push(x, z, r2);
      i += 3;
    }

    if (authority) {
      if (authority === "anchor") where.push(`spawn_id LIKE 'anchor:%'`);
      else if (authority === "seed") where.push(`spawn_id LIKE 'seed:%'`);
      else if (authority === "brain") where.push(`spawn_id LIKE 'brain:%'`);
      else where.push(`spawn_id NOT LIKE 'anchor:%' AND spawn_id NOT LIKE 'seed:%' AND spawn_id NOT LIKE 'brain:%'`);
    }

    if (typeQ) {
      where.push(`LOWER(type) = LOWER($${i++})`);
      args.push(typeQ);
    }

    if (archetypeQ) {
      where.push(`LOWER(archetype) = LOWER($${i++})`);
      args.push(archetypeQ);
    }

    if (protoQ) {
      where.push(`proto_id ILIKE $${i++}`);
      args.push(`%${protoQ}%`);
    }

    if (spawnQ) {
      where.push(`spawn_id ILIKE $${i++}`);
      args.push(`%${spawnQ}%`);
    }

    const countSql = `SELECT COUNT(1)::int AS n FROM spawn_points WHERE ${where.join(" AND ")}`;
    const countRes = await db.query(countSql, args);
    const total = Number(countRes.rows?.[0]?.n ?? 0);
    if (total > MAX_ROWS) {
      return res.status(400).json({
        kind: "spawn_points.snapshot_query",
        ok: false,
        error: "too_many_rows",
        total,
        max: MAX_ROWS,
      });
    }

    const sql = `
      SELECT
        shard_id,
        spawn_id,
        type,
        archetype,
        proto_id,
        variant_id,
        x,
        y,
        z,
        region_id,
        town_tier
      FROM spawn_points
      WHERE ${where.join(" AND ")}
      ORDER BY id ASC
      LIMIT ${MAX_ROWS}
    `;

    const rowsRes = await db.query(sql, args);
    const spawns: SnapshotSpawnRow[] = (rowsRes.rows || []).map((r: any) => ({
      shardId: String(r.shard_id),
      spawnId: String(r.spawn_id),
      type: String(r.type),
      protoId: String(r.proto_id ?? ""),
      archetype: String(r.archetype),
      variantId: r.variant_id ? String(r.variant_id) : null,
      x: Number(r.x ?? 0),
      y: Number(r.y ?? 0),
      z: Number(r.z ?? 0),
      regionId: String(r.region_id ?? ""),
      townTier: r.town_tier === null || r.town_tier === undefined ? null : Number(r.town_tier),
    }));

    // bounds: compute from coords so restore workflows still get a meaningful slice envelope.
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

    // types: if filtered by typeQ use it, otherwise infer unique types (capped).
    const types = typeQ ? [typeQ] : Array.from(new Set(spawns.map((s) => s.type))).slice(0, 50);

    const snapshot: SpawnSliceSnapshot = {
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

    const safeRegion = regionId ? `region_${regionId}` : x !== null && z !== null && radius !== null ? `r${radius}_x${x}_z${z}` : "query";
    const filename = `snapshot_query_${new Date().toISOString().replace(/[:.]/g, "-")}_${shardId}_${safeRegion}.json`;

    return res.json({ kind: "spawn_points.snapshot_query", ok: true, filename, snapshot, total: spawns.length });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] snapshot_query error", err);
    return res.status(500).json({ kind: "spawn_points.snapshot_query", ok: false, error: err?.message || String(err) });
  }
});


// POST /api/admin/spawn_points/snapshots/save_query
router.post("/snapshots/save_query", async (req, res) => {
  try {
    const nameRaw = strOrNull(req.body?.name);
    if (!nameRaw) return res.status(400).json({ kind: "spawn_points.snapshots.save_query", ok: false, error: "missing_name" });

    const shardId = String(req.body?.shardId ?? "prime_shard").trim();

    const regionId = strOrNull(req.body?.regionId);
    const x = numOrNull(req.body?.x);
    const z = numOrNull(req.body?.z);
    const radius = numOrNull(req.body?.radius);

    const authority = normalizeAuthority(req.body?.authority);
    const typeQ = strOrNull(req.body?.type);
    const archetypeQ = strOrNull(req.body?.archetype);
    const protoQ = strOrNull(req.body?.protoId);
    const spawnQ = strOrNull(req.body?.spawnId);

    const cellSize = Math.max(1, Math.min(1024, Number(req.body?.cellSize ?? 64)));
    const pad = Math.max(0, Math.min(1000, Number(req.body?.pad ?? 0)));

    const tags = normalizeSnapshotTags(req.body?.tags);
    const notes = safeSnapshotNotes(req.body?.notes);

    const MAX_ROWS = 5000;

    const where: string[] = ["shard_id = $1"];
    const args: any[] = [shardId];
    let i = 2;

    if (regionId) {
      where.push(`region_id = $${i++}`);
      args.push(regionId);
    }

    if (!regionId && x !== null && z !== null && radius !== null) {
      const safeRadius = Math.max(0, Math.min(radius, 10_000));
      const r2 = safeRadius * safeRadius;

      where.push(`x IS NOT NULL AND z IS NOT NULL`);
      where.push(`((x - $${i}) * (x - $${i}) + (z - $${i + 1}) * (z - $${i + 1})) <= $${i + 2}`);
      args.push(x, z, r2);
      i += 3;
    }

    if (authority) {
      if (authority === "anchor") where.push(`spawn_id LIKE 'anchor:%'`);
      else if (authority === "seed") where.push(`spawn_id LIKE 'seed:%'`);
      else if (authority === "brain") where.push(`spawn_id LIKE 'brain:%'`);
      else where.push(`spawn_id NOT LIKE 'anchor:%' AND spawn_id NOT LIKE 'seed:%' AND spawn_id NOT LIKE 'brain:%'`);
    }

    if (typeQ) {
      where.push(`LOWER(type) = LOWER($${i++})`);
      args.push(typeQ);
    }

    if (archetypeQ) {
      where.push(`LOWER(archetype) = LOWER($${i++})`);
      args.push(archetypeQ);
    }

    if (protoQ) {
      where.push(`proto_id ILIKE $${i++}`);
      args.push(`%${protoQ}%`);
    }

    if (spawnQ) {
      where.push(`spawn_id ILIKE $${i++}`);
      args.push(`%${spawnQ}%`);
    }

    const countSql = `SELECT COUNT(1)::int AS n FROM spawn_points WHERE ${where.join(" AND ")}`;
    const countRes = await db.query(countSql, args);
    const total = Number(countRes.rows?.[0]?.n ?? 0);
    if (total > MAX_ROWS) {
      return res.status(400).json({
        kind: "spawn_points.snapshots.save_query",
        ok: false,
        error: "too_many_rows",
        total,
        max: MAX_ROWS,
      });
    }

    const sql = `
      SELECT
        shard_id,
        spawn_id,
        type,
        archetype,
        proto_id,
        variant_id,
        x,
        y,
        z,
        region_id,
        town_tier
      FROM spawn_points
      WHERE ${where.join(" AND ")}
      ORDER BY id ASC
      LIMIT ${MAX_ROWS}
    `;

    const rowsRes = await db.query(sql, args);
    const spawns: SnapshotSpawnRow[] = (rowsRes.rows || []).map((r: any) => ({
      shardId: String(r.shard_id),
      spawnId: String(r.spawn_id),
      type: String(r.type),
      protoId: String(r.proto_id ?? ""),
      archetype: String(r.archetype),
      variantId: r.variant_id ? String(r.variant_id) : null,
      x: Number(r.x ?? 0),
      y: Number(r.y ?? 0),
      z: Number(r.z ?? 0),
      regionId: String(r.region_id ?? ""),
      townTier: r.town_tier === null || r.town_tier === undefined ? null : Number(r.town_tier),
    }));

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

    const snapshot: SpawnSliceSnapshot = {
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

    const name = safeSnapshotName(nameRaw);
    const id = makeSnapshotId(name, shardId, snapshot.bounds, snapshot.types);
    const savedAt = new Date().toISOString();

    const doc: StoredSpawnSnapshotDoc = {
      kind: "admin.stored-spawn-snapshot",
      version: 2,
      id,
      name,
      savedAt,
      tags,
      notes,
      snapshot,
    };

    const dir = await ensureSnapshotDir();
    const file = path.join(dir, `${id}.json`);
    const raw = JSON.stringify(doc, null, 2);
    await fs.writeFile(file, raw, "utf8");

    const meta = metaFromStoredDoc(doc, Buffer.byteLength(raw, "utf8"));
    return res.json({ kind: "spawn_points.snapshots.save_query", ok: true, snapshot: meta, total: spawns.length });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] snapshots save_query error", err);
    return res
      .status(500)
      .json({ kind: "spawn_points.snapshots.save_query", ok: false, error: err?.message || String(err) });
  }
});

// GET /api/admin/spawn_points/snapshots
router.get("/snapshots", async (req, res) => {
  try {
    let snapshots = await listStoredSnapshots();

    const tagRaw = strOrNull((req as any).query?.tag);
    const qRaw = strOrNull((req as any).query?.q);
    const sortRaw = (strOrNull((req as any).query?.sort) || "newest").toLowerCase();
    const limitRaw = Number((req as any).query?.limit);

    const tag = tagRaw ? normalizeSnapshotTags(tagRaw)[0] : null;
    const q = qRaw ? qRaw.trim().toLowerCase() : "";

    if (tag) {
      snapshots = snapshots.filter((s) => Array.isArray((s as any).tags) && (s as any).tags.includes(tag));
    }

    if (q) {
      snapshots = snapshots.filter((s) => {
        const name = String((s as any).name || "").toLowerCase();
        const notes = String((s as any).notes || "").toLowerCase();
        const tags = Array.isArray((s as any).tags) ? (s as any).tags.join(" ").toLowerCase() : "";
        return name.includes(q) || notes.includes(q) || tags.includes(q);
      });
    }

    if (sortRaw === "oldest") {
      snapshots = snapshots.slice().sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    } else if (sortRaw === "name") {
      snapshots = snapshots.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } else {
      // newest (default)
      snapshots = snapshots.slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    }

    const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.min(500, Math.floor(limitRaw))) : 0;
    if (limit > 0) snapshots = snapshots.slice(0, limit);

    return res.json({ kind: "spawn_points.snapshots", ok: true, snapshots });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] list snapshots error", err);
    return res.status(500).json({ kind: "spawn_points.snapshots", ok: false, error: "internal_error" });
  }
});


// POST /api/admin/spawn_points/snapshots/save
router.post("/snapshots/save", async (req, res) => {
  try {
    const nameRaw = strOrNull(req.body?.name);
    if (!nameRaw) return res.status(400).json({ kind: "spawn_points.snapshots.save", ok: false, error: "missing_name" });

    const shardId = strOrNull(req.body?.shardId) ?? "prime_shard";
    const boundsRaw = strOrNull(req.body?.bounds);
    if (!boundsRaw) return res.status(400).json({ kind: "spawn_points.snapshots.save", ok: false, error: "missing_bounds" });

    const types = Array.isArray(req.body?.types) ? (req.body.types as any[]).map((t) => String(t)).filter(Boolean) : [];
    if (!types.length) return res.status(400).json({ kind: "spawn_points.snapshots.save", ok: false, error: "missing_types" });

    const cellSize = Math.max(1, Number(req.body?.cellSize) || 512);
    const pad = Math.max(0, Number(req.body?.pad) || 0);

    const { snapshot } = await computeSpawnSliceSnapshot({ shardId, boundsRaw, cellSize, pad, types });

    const name = safeSnapshotName(nameRaw);
    const id = makeSnapshotId(name, shardId, snapshot.bounds, snapshot.types);
    const savedAt = new Date().toISOString();

    const tags = normalizeSnapshotTags(req.body?.tags);
    const notes = safeSnapshotNotes(req.body?.notes);

    const doc: StoredSpawnSnapshotDoc = {
      kind: "admin.stored-spawn-snapshot",
      version: 2,
      id,
      name,
      savedAt,
      tags,
      notes,
      snapshot,
    };

    const dir = await ensureSnapshotDir();
    const file = path.join(dir, `${id}.json`);
    const raw = JSON.stringify(doc, null, 2);
    await fs.writeFile(file, raw, "utf8");

    const meta = metaFromStoredDoc(doc, Buffer.byteLength(raw, "utf8"));
    return res.json({ kind: "spawn_points.snapshots.save", ok: true, snapshot: meta });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] snapshots save error", err);
    return res.status(500).json({ kind: "spawn_points.snapshots.save", ok: false, error: err.message || String(err) });
  }
});

// GET /api/admin/spawn_points/snapshots/:id
router.get("/snapshots/:id", async (req, res) => {
  try {
    const id = strOrNull(req.params?.id);
    if (!id) return res.status(400).json({ kind: "spawn_points.snapshots.get", ok: false, error: "missing_id" });

    const { doc } = await readStoredSnapshotById(id);
    return res.json({ kind: "spawn_points.snapshots.get", ok: true, doc });
  } catch (err: any) {
    const msg = err.message || String(err);
    const status = /no such file/i.test(msg) || /ENOENT/i.test(msg) ? 404 : 500;
    console.error("[ADMIN/SPAWN_POINTS] snapshots get error", err);
    return res.status(status).json({ kind: "spawn_points.snapshots.get", ok: false, error: msg });
  }
});


// PUT /api/admin/spawn_points/snapshots/:id
// Body: { name?, tags?, notes? }
router.put("/snapshots/:id", async (req, res) => {
  try {
    const id = strOrNull(req.params?.id);
    if (!id) return res.status(400).json({ kind: "spawn_points.snapshots.update", ok: false, error: "missing_id" });

    const { doc } = await readStoredSnapshotById(id);

    const nameRaw = strOrNull(req.body?.name);
    const tagsRaw = req.body?.tags;
    const notesRaw = req.body?.notes;

    const nextName = nameRaw ? safeSnapshotName(nameRaw) : doc.name;
    const nextTags = tagsRaw !== undefined ? normalizeSnapshotTags(tagsRaw) : (Array.isArray((doc as any).tags) ? (doc as any).tags : []);
    const nextNotes =
      notesRaw === undefined
        ? ((doc as any).notes ?? null)
        : notesRaw === null
          ? null
          : String(notesRaw).slice(0, 2000);

    const updated: StoredSpawnSnapshotDoc = {
      ...doc,
      name: nextName,
      tags: nextTags,
      notes: nextNotes,
    };

    const dir = await ensureSnapshotDir();
    const file = path.join(dir, `${id}.json`);
    await fs.writeFile(file, JSON.stringify(updated, null, 2) + "\n", "utf8");

    const raw = await fs.readFile(file, "utf8");
    const bytes = Buffer.byteLength(raw, "utf8");
    const meta = metaFromStoredDoc(updated, bytes);

    return res.json({ kind: "spawn_points.snapshots.update", ok: true, snapshot: meta });
  } catch (err: any) {
    const msg = err.message || String(err);
    const status = /no such file/i.test(msg) || /ENOENT/i.test(msg) ? 404 : 500;
    console.error("[ADMIN/SPAWN_POINTS] snapshots update error", err);
    return res.status(status).json({ kind: "spawn_points.snapshots.update", ok: false, error: msg });
  }
});

// POST /api/admin/spawn_points/snapshots/:id/duplicate
// Body: { name?, tags?, notes? }
router.post("/snapshots/:id/duplicate", async (req, res) => {
  try {
    const id = strOrNull(req.params?.id);
    if (!id) {
      return res
        .status(400)
        .json({ kind: "spawn_points.snapshots.duplicate", ok: false, error: "missing_id" } satisfies DuplicateSnapshotResponse);
    }

    const { doc } = await readStoredSnapshotById(id);

    const nameRaw = strOrNull(req.body?.name);
    const tagsRaw = req.body?.tags;
    const notesRaw = req.body?.notes;

    const baseName = safeSnapshotName(nameRaw ? nameRaw : `${doc.name} copy`);
    const shardId = doc.snapshot.shardId;
    const bounds = doc.snapshot.bounds;
    const types = Array.isArray(doc.snapshot.types) ? doc.snapshot.types : [];

    const newId = await allocateSnapshotIdUnique(baseName, shardId, bounds, types);
    const now = new Date().toISOString();

    const tags = tagsRaw === undefined ? (Array.isArray((doc as any).tags) ? (doc as any).tags : []) : normalizeSnapshotTags(tagsRaw);
    const notes = notesRaw === undefined ? ((doc as any).notes ?? null) : safeSnapshotNotes(notesRaw);

    const cloned: StoredSpawnSnapshotDoc = {
      kind: "admin.stored-spawn-snapshot",
      version: doc.version,
      id: newId,
      name: baseName,
      savedAt: now,
      tags,
      notes,
      snapshot: doc.snapshot,
    };

    const dir = await ensureSnapshotDir();
    const file = path.join(dir, `${newId}.json`);
    const raw = JSON.stringify(cloned, null, 2) + "\n";
    await fs.writeFile(file, raw, "utf8");

    const bytes = Buffer.byteLength(raw, "utf8");
    const meta = metaFromStoredDoc(cloned, bytes);

    return res.json({ kind: "spawn_points.snapshots.duplicate", ok: true, snapshot: meta } satisfies DuplicateSnapshotResponse);
  } catch (err: any) {
    const msg = err.message || String(err);
    const status = /no such file/i.test(msg) || /ENOENT/i.test(msg) ? 404 : 500;
    console.error("[ADMIN/SPAWN_POINTS] snapshots duplicate error", err);
    return res
      .status(status)
      .json({ kind: "spawn_points.snapshots.duplicate", ok: false, error: msg } satisfies DuplicateSnapshotResponse);
  }
});

// DELETE /api/admin/spawn_points/snapshots/:id
router.delete("/snapshots/:id", async (req, res) => {
  try {
    const id = strOrNull(req.params?.id);
    if (!id) return res.status(400).json({ kind: "spawn_points.snapshots.delete", ok: false, error: "missing_id" });

    const dir = await ensureSnapshotDir();
    const file = path.join(dir, `${id}.json`);
    await fs.unlink(file);

    return res.json({ kind: "spawn_points.snapshots.delete", ok: true, id });
  } catch (err: any) {
    const msg = err.message || String(err);
    const status = /no such file/i.test(msg) || /ENOENT/i.test(msg) ? 404 : 500;
    console.error("[ADMIN/SPAWN_POINTS] snapshots delete error", err);
    return res.status(status).json({ kind: "spawn_points.snapshots.delete", ok: false, error: msg });
  }
});

// POST /api/admin/spawn_points/restore
// Body:
//   snapshot (object|string), targetShard?, updateExisting?, allowBrainOwned?, commit?, confirm?
router.post("/restore", async (req, res) => {
  try {
    const snapshotRaw = req.body?.snapshot ?? req.body;
    const snapshotObj =
      typeof snapshotRaw === "string" ? JSON.parse(snapshotRaw) : snapshotRaw;

    const { snapshotShard, bounds: snapshotBounds, cellSize: snapshotCellSize, pad: snapshotPad, types: snapshotTypes, spawns } = coerceSnapshotSpawns(snapshotObj);

    const targetShard = String(req.body?.targetShard ?? snapshotShard ?? "prime_shard").trim() || "prime_shard";
    const updateExisting = Boolean(req.body?.updateExisting);
    const allowBrainOwned = Boolean(req.body?.allowBrainOwned);
    const allowProtected = Boolean(req.body?.allowProtected);
    const commit = Boolean(req.body?.commit);
    const confirm = String(req.body?.confirm ?? "").trim() || null;

    const spawnIds = spawns.map((s) => String(s.spawnId)).filter(Boolean);
    if (spawnIds.length === 0) {
      return res.status(400).json({ kind: "spawn_points.restore", ok: false, error: "empty_snapshot" });
    }

    // Preload which spawnIds already exist in target shard
    const client = await db.connect();
    let existingSet = new Set<string>();
    try {
      const q = await client.query(
        `SELECT spawn_id FROM spawn_points WHERE shard_id = $1 AND spawn_id = ANY($2::text[])`,
        [targetShard, spawnIds],
      );
      for (const r of q.rows as any[]) existingSet.add(String(r.spawn_id));
    } finally {
      client.release();
    }

    // Preload which existing rows are protected (locked or editor-owned)
    let protectedSet = new Set<string>();
    if (updateExisting && !allowProtected) {
      const pclient = await db.connect();
      try {
        const pq = await pclient.query(
          `SELECT spawn_id FROM spawn_points WHERE shard_id = $1 AND spawn_id = ANY($2::text[]) AND (is_locked = TRUE OR owner_kind = 'editor')`,
          [targetShard, spawnIds],
        );
        for (const r of pq.rows as any[]) protectedSet.add(String(r.spawn_id));
      } finally {
        pclient.release();
      }
    }
    // P5: mismatch diff — if the snapshot includes bounds/cellSize/pad/types, compare it to the current target slice.
    // This does NOT imply deletion; it simply highlights rows currently in the target slice that are not present in the snapshot.
    let extraTargetIds: string[] = [];
    let extraTargetCount: number | undefined;

    const haveSliceMeta =
      !!snapshotBounds &&
      Number.isFinite(Number(snapshotCellSize)) &&
      Number.isFinite(Number(snapshotPad)) &&
      Array.isArray(snapshotTypes) &&
      snapshotTypes.length > 0;

    if (haveSliceMeta) {
      const cellSize = Math.max(1, Math.floor(Number(snapshotCellSize)));
      const pad = Math.max(0, Math.floor(Number(snapshotPad)));

      const minX = snapshotBounds.minCx * cellSize - pad;
      const maxX = (snapshotBounds.maxCx + 1) * cellSize + pad;
      const minZ = snapshotBounds.minCz * cellSize - pad;
      const maxZ = (snapshotBounds.maxCz + 1) * cellSize + pad;

      const snapshotIdSet = new Set<string>(spawnIds);

      const sliceClient = await db.connect();
      try {
        const q = await sliceClient.query(
          `
            SELECT spawn_id
            FROM spawn_points
            WHERE shard_id = $1
              AND type = ANY($2::text[])
              AND x >= $3 AND x <= $4
              AND z >= $5 AND z <= $6
            ORDER BY spawn_id
          `,
          [targetShard, snapshotTypes, minX, maxX, minZ, maxZ],
        );

        let count = 0;
        const list: string[] = [];
        for (const r of q.rows as any[]) {
          const sid = String(r.spawn_id ?? "");
          if (!sid) continue;
          if (snapshotIdSet.has(sid)) continue;
          count++;
          if (list.length < 75) list.push(sid);
        }
        extraTargetCount = count;
        extraTargetIds = list;
      } finally {
        sliceClient.release();
      }
    }

    const insertIds: string[] = [];

    const updateIds: string[] = [];
    const protectedUpdateIds: string[] = [];
    const skipIds: string[] = [];
    const readOnlyIds: string[] = [];

    for (const s of spawns) {
      const sid = String(s.spawnId);
      if (!sid) continue;

      if (!allowBrainOwned && !isSpawnEditable(sid)) {
        readOnlyIds.push(sid);
        continue;
      }

      const exists = existingSet.has(sid);
      if (!exists) insertIds.push(sid);
      else if (updateExisting) {
        updateIds.push(sid);
        if (!allowProtected && protectedSet.has(sid)) protectedUpdateIds.push(sid);
      }
      else skipIds.push(sid);
    }

    const opsPreview = buildSpawnSliceOpsPreview({
      insertIds,
      updateIds,
      skipIds,
      readOnlyIds,
      extraTargetIds,
      extraTargetCount,
      limit: 75,
    });

    if (protectedUpdateIds.length > 0) {
      (opsPreview as any).protectedUpdateSpawnIds = protectedUpdateIds.slice(0, 75);
      (opsPreview as any).skippedProtected = protectedUpdateIds.length;
    }
    const expectedConfirmToken =
      updateExisting && updateIds.length > 0
        ? makeConfirmToken("REPLACE", targetShard, { op: "restore", updateIds, rows: spawns.length })
        : null;

    // Additional destructive safety: when committing a restore that (a) crosses shards or (b) allows brain-owned spawn_ids,
    // require a human-confirm phrase in addition to any token gate.
    const expectedConfirmPhrase =
      commit && (targetShard !== snapshotShard || allowBrainOwned || allowProtected) ? "RESTORE" : null;
    const confirmPhrase = String(req.body?.confirmPhrase ?? "").trim() || null;

    // Confirm phrase gate (high-risk restore modes)
    if (commit && expectedConfirmPhrase && confirmPhrase !== expectedConfirmPhrase) {
      return res.status(409).json({
        kind: "spawn_points.restore",
        ok: false,
        error: "confirm_phrase_required",
        expectedConfirmPhrase,
        expectedConfirmToken: expectedConfirmToken ?? undefined,
        opsPreview,
        snapshotShard,
        targetShard,
        rows: spawns.length,
        snapshotBounds: snapshotBounds ?? undefined,
        snapshotCellSize: snapshotCellSize ?? undefined,
        snapshotPad: snapshotPad ?? undefined,
        snapshotTypes: snapshotTypes ?? undefined,
        crossShard: targetShard !== snapshotShard,
        allowBrainOwned,
      allowProtected,
        wouldInsert: insertIds.length,
        wouldUpdate: updateIds.length,
        wouldSkip: skipIds.length,
        wouldReadOnly: readOnlyIds.length,
      });
    }

    // Confirm token gate (destructive updates to existing rows)
    if (commit && expectedConfirmToken && confirm !== expectedConfirmToken) {
      return res.status(409).json({
        kind: "spawn_points.restore",
        ok: false,
        error: "confirm_required",
        expectedConfirmToken,
        expectedConfirmPhrase: expectedConfirmPhrase ?? undefined,
        opsPreview,
        snapshotShard,
        targetShard,
        rows: spawns.length,
        snapshotBounds: snapshotBounds ?? undefined,
        snapshotCellSize: snapshotCellSize ?? undefined,
        snapshotPad: snapshotPad ?? undefined,
        snapshotTypes: snapshotTypes ?? undefined,
        crossShard: targetShard !== snapshotShard,
        allowBrainOwned,
        wouldInsert: insertIds.length,
        wouldUpdate: updateIds.length,
        wouldSkip: skipIds.length,
        wouldReadOnly: readOnlyIds.length,
      });
    }

    const txn = await db.connect();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let skippedReadOnly = 0;
    let skippedProtected = 0;

    try {
      await txn.query("BEGIN");

      for (const s of spawns) {
        const sid = String(s.spawnId);
        if (!sid) continue;

        if (!allowBrainOwned && !isSpawnEditable(sid)) {
          skippedReadOnly++;
          continue;
        }

        const exists = existingSet.has(sid);
        const protoId = String(s.protoId ?? sid);
        const archetype = String(s.archetype ?? "");
        const type = String(s.type ?? "");
        const variantId = s.variantId == null ? null : String(s.variantId);
        const x = Number.isFinite(s.x) ? Number(s.x) : 0;
        const y = Number.isFinite(s.y) ? Number(s.y) : 0;
        const z = Number.isFinite(s.z) ? Number(s.z) : 0;
        const regionId = String(s.regionId ?? "");
        const townTier = s.townTier == null || !Number.isFinite(Number(s.townTier)) ? null : Number(s.townTier);

        if (!exists) {
          await txn.query(
            `
            INSERT INTO spawn_points (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          `,
            [targetShard, sid, type, archetype, protoId, variantId, x, y, z, regionId, townTier],
          );
          inserted++;
          continue;
        }

        if (updateExisting) {
          if (!allowProtected && protectedSet.has(sid)) {
            skippedProtected++;
            continue;
          }

          await txn.query(
            `
            UPDATE spawn_points
            SET type=$3, archetype=$4, proto_id=$5, variant_id=$6, x=$7, y=$8, z=$9, region_id=$10, town_tier=$11
            WHERE shard_id=$1 AND spawn_id=$2
          `,
            [targetShard, sid, type, archetype, protoId, variantId, x, y, z, regionId, townTier],
          );
          updated++;
        } else {
          skipped++;
        }
      }

      if (commit) {
        await txn.query("COMMIT");
      } else {
        await txn.query("ROLLBACK");
      }
    } catch (err) {
      try {
        await txn.query("ROLLBACK");
      } catch {}
      throw err;
    } finally {
      txn.release();
    }

    if (commit) {
      clearSpawnPointCache();
    }

    res.json({
      kind: "spawn_points.restore",
      ok: true,
      commit,
      snapshotShard,
      targetShard,
      crossShard: targetShard !== snapshotShard,
      allowBrainOwned,
      allowProtected,
      rows: spawns.length,
        snapshotBounds: snapshotBounds ?? undefined,
        snapshotCellSize: snapshotCellSize ?? undefined,
        snapshotPad: snapshotPad ?? undefined,
        snapshotTypes: snapshotTypes ?? undefined,
      inserted,
      updated,
      skipped,
      skippedReadOnly,
      skippedProtected,
      expectedConfirmToken: expectedConfirmToken ?? undefined,
      expectedConfirmPhrase: expectedConfirmPhrase ?? undefined,
      opsPreview,
    });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] restore error", err);
    res.status(500).json({ kind: "spawn_points.restore", ok: false, error: "server_error" });
  }
});

router.get("/mother_brain/status", async (req, res) => {
  try {
    const shardId = strOrNull(req.query.shardId) ?? "prime_shard";
    const bounds = strOrNull(req.query.bounds) ?? "-1..1,-1..1";
    const cellSize = Number(req.query.cellSize ?? 64);
    const themeQ = strOrNull(req.query.theme);
    const epochQ = strOrNull(req.query.epoch);
    const listRaw = String(req.query.list ?? "").trim().toLowerCase();
    const wantList = listRaw === "true" || listRaw === "1" || listRaw === "yes" || listRaw === "y";
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 15)));

    const parsedBounds = parseCellBounds(bounds);
    const box = toWorldBox(parsedBounds, Number.isFinite(cellSize) ? cellSize : 64, 0);

    const rowsRes = await db.query(
      `
      SELECT spawn_id, type, proto_id, region_id
      FROM spawn_points
      WHERE shard_id = $1
        AND spawn_id LIKE 'brain:%'
        AND x >= $2 AND x <= $3
        AND z >= $4 AND z <= $5
      `,
      [shardId, box.minX, box.maxX, box.minZ, box.maxZ],
    );

    const byTheme: Record<string, number> = {};
    const byEpoch: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const topProto: Record<string, number> = {};

    const filtered = (rowsRes.rows ?? []).filter((r: any) => {
      const sid = String(r.spawn_id ?? "");
      if (!isBrainSpawnId(sid)) return false;
      const meta = parseBrainSpawnId(sid);
      if (themeQ && meta.theme !== themeQ) return false;
      if (epochQ != null) {
        const want = Number(epochQ);
        if (Number.isFinite(want) && meta.epoch !== want) return false;
      }
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
      shardId,
      bounds,
      cellSize: Number.isFinite(cellSize) ? cellSize : 64,
      theme: themeQ ?? null,
      epoch: epochQ != null && Number.isFinite(Number(epochQ)) ? Number(epochQ) : null,
      total: filtered.length,
      box,
      byTheme,
      byEpoch,
      byType,
      topProto,
    };

    if (wantList) {
      const list: MotherBrainListRow[] = filtered
        .slice()
        .sort((a: any, b: any) => String(a.spawn_id ?? "").localeCompare(String(b.spawn_id ?? "")))
        .slice(0, limit)
        .map((r: any) => ({
          spawnId: String(r.spawn_id ?? ""),
          type: String(r.type ?? ""),
          protoId: strOrNull(r.proto_id),
          regionId: strOrNull(r.region_id),
        }));
      response.list = list;
    }

    res.json(response);
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] mother_brain/status error", err);
    res.status(400).json({ ok: false, error: String(err?.message ?? "bad_request") });
  }
});


router.post("/mother_brain/wave", async (req, res) => {
  const body: MotherBrainWaveRequest = (req.body ?? {}) as any;

  const shardId = (body.shardId ?? "prime_shard").toString();
  const rawBounds = (body.bounds ?? "-4..4,-4..4").toString();

  const cellSize = Math.max(1, Math.min(256, Number(body.cellSize ?? 64) || 64));

  // CELLS padding for selection/deletion.
  const borderMargin = Math.max(0, Math.min(25, Number(body.borderMargin ?? 0) || 0));

  // WORLD inset for placement within each cell.
  const placeInset = Math.max(0, Math.min(Math.floor(cellSize / 2), Number(body.placeInset ?? 0) || 0));

  const seed = (body.seed ?? "seed:mother").toString();
  const epoch = Math.max(0, Number(body.epoch ?? 0) || 0);
  const theme = (body.theme ?? "goblins").toString();
  const count = Math.max(1, Math.min(5000, Number(body.count ?? 8) || 8));
  const append = Boolean(body.append ?? false);
  const updateExisting = Boolean(body.updateExisting ?? false);
  const commit = Boolean(body.commit ?? false);

  const parsedBounds = parseCellBounds(rawBounds);
  const box = toWorldBox(parsedBounds, cellSize, borderMargin);

  const capOrNull = (n: any, fallback: number | null): number | null => {
    if (n === null) return null;
    if (n === undefined) return fallback;
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    const i = Math.floor(v);
    if (i <= 0) return null;
    return i;
  };

  // Safe defaults (hardening). Send <=0 or null to disable a cap.
  const defaultBudget = {
    maxTotalInBounds: 5000,
    maxThemeInBounds: 2500,
    maxEpochThemeInBounds: 2000,
    maxNewInserts: 1000,
  };

  const budget = {
    maxTotalInBounds: capOrNull(body.budget?.maxTotalInBounds, defaultBudget.maxTotalInBounds),
    maxThemeInBounds: capOrNull(body.budget?.maxThemeInBounds, defaultBudget.maxThemeInBounds),
    maxEpochThemeInBounds: capOrNull(body.budget?.maxEpochThemeInBounds, defaultBudget.maxEpochThemeInBounds),
    maxNewInserts: capOrNull(body.budget?.maxNewInserts, defaultBudget.maxNewInserts),
  };

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Existing brain:* spawn_ids inside the selection box (for replace-mode deletion + budgeting).
    const existingBrainRes = await client.query(
      `
        SELECT id, spawn_id
        FROM spawn_points
        WHERE shard_id = $1
          AND spawn_id LIKE 'brain:%'
          AND x >= $2 AND x <= $3
          AND z >= $4 AND z <= $5
      `,
      [shardId, box.minX, box.maxX, box.minZ, box.maxZ],
    );

    const existingBrainIds: number[] = (existingBrainRes.rows ?? [])
      .map((r: any) => Number(r.id))
      .filter((n: number) => Number.isFinite(n));

    const existingBrainSpawnIds: string[] = (existingBrainRes.rows ?? [])
      .map((r: any) => String(r.spawn_id ?? ""))
      .filter(Boolean);

const expectedConfirmToken =
  !append && existingBrainIds.length > 0
    ? makeConfirmToken("REPLACE", shardId, {
        bounds: rawBounds,
        cellSize,
        borderMargin,
        // box is derived from bounds/cellSize/borderMargin but included for human sanity.
        box,
        deleteScope: "brain:* in selection box",
      })
    : null;

// Destructive safety: replace-mode commits that would delete rows require a confirm token.
// This makes it much harder to fat-finger a wipe from the UI.
const confirm = strOrNull((body as any).confirm);
if (commit && expectedConfirmToken && confirm !== expectedConfirmToken) {
  await client.query("ROLLBACK");
  res.status(409).json({
    kind: "mother_brain.wave",
    ok: false,
    error: "confirm_required",
    expectedConfirmToken,
    shardId,
    bounds: rawBounds,
    cellSize,
    borderMargin,
    theme,
    epoch,
    append,
    wouldDelete: existingBrainIds.length,
    opsPreview: {
      limit: 75,
      truncated: existingBrainSpawnIds.length > 75,
      deleteSpawnIds: [...existingBrainSpawnIds]
        .map((s: any) => String(s ?? ""))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 75),
    },
  } satisfies MotherBrainWaveResponse);
  return;
}


    const plannedActions = planBrainWave({
      shardId,
      bounds: parsedBounds,
      cellSize,
      borderMargin: placeInset,
      seed,
      epoch,
      theme: theme as any,
      count,
    });

    const plannedSpawnIds: string[] = (plannedActions ?? [])
      .map((a: any) => String(a?.spawn?.spawnId ?? ""))
      .filter(Boolean);

    const existingSpawnIds = new Set<string>();
    if (plannedSpawnIds.length > 0) {
      const existRes = await client.query(
        `SELECT spawn_id FROM spawn_points WHERE shard_id = $1 AND spawn_id = ANY($2::text[])`,
        [shardId, plannedSpawnIds],
      );
      for (const r of existRes.rows ?? []) existingSpawnIds.add(String(r.spawn_id ?? ""));
    }

    // Replace-mode subtlety:
    // If append=false, we will delete existing brain:* spawns in the box before applying the wave.
    // Those spawn_ids must be treated as "non-existing" for insert/skip/update decisions,
    // otherwise we can accidentally delete everything and then skip re-inserting it.
    const effectiveExistingSpawnIds = new Set<string>(existingSpawnIds);
    if (!append) {
      for (const sid of existingBrainSpawnIds) effectiveExistingSpawnIds.delete(String(sid ?? ""));
    }

    const budgetReport = computeBrainWaveBudgetReport({
      existingBrainSpawnIdsInBox: existingBrainSpawnIds,
      append,
      theme,
      epoch,
      budget,
    });

    const budgetFilter = filterPlannedActionsToBudget({
      plannedActions: plannedActions as any,
      existingSpawnIds: effectiveExistingSpawnIds,
      updateExisting,
      allowedNewInserts: budgetReport.allowedNewInserts,
    });

    const applyPlan = computeBrainWaveApplyPlan({
      plannedActions: budgetFilter.filteredActions as any,
      existingSpawnIds: effectiveExistingSpawnIds,
      existingBrainSpawnIdsInBox: existingBrainSpawnIds,
      append,
      updateExisting,
    });

    let deleted = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    if (commit) {
      if (!append && existingBrainIds.length > 0) {
        await client.query(`DELETE FROM spawn_points WHERE id = ANY($1::int[])`, [existingBrainIds]);
        deleted = existingBrainIds.length;
      }

      for (const a of budgetFilter.filteredActions as any[]) {
        if (!a || (a as any).kind !== "place_spawn") continue;
        const s = (a as any).spawn ?? null;
        const sid = String(s?.spawnId ?? "");
        if (!sid) continue;

        const exists = effectiveExistingSpawnIds.has(sid);
        if (exists) {
          if (!updateExisting) {
            skipped += 1;
            continue;
          }

          await client.query(
            `
              UPDATE spawn_points
              SET type = $3,
                  archetype = $4,
                  proto_id = $5,
                  variant_id = $6,
                  x = $7,
                  y = $8,
                  z = $9,
                  region_id = $10
              WHERE shard_id = $1 AND spawn_id = $2
            `,
            [
              shardId,
              sid,
              String(s?.type ?? "npc"),
              String(s?.archetype ?? "npc"),
              s?.protoId != null ? String(s.protoId) : null,
              s?.variantId != null ? String(s.variantId) : null,
              Number(s?.x ?? 0),
              Number(s?.y ?? 0),
              Number(s?.z ?? 0),
              s?.regionId != null ? String(s.regionId) : null,
            ],
          );
          updated += 1;
          continue;
        }

        await client.query(
          `
            INSERT INTO spawn_points (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            shardId,
            sid,
            String(s?.type ?? "npc"),
            String(s?.archetype ?? "npc"),
            s?.protoId != null ? String(s.protoId) : null,
            s?.variantId != null ? String(s.variantId) : null,
            Number(s?.x ?? 0),
            Number(s?.y ?? 0),
            Number(s?.z ?? 0),
            s?.regionId != null ? String(s.regionId) : null,
          ],
        );
        inserted += 1;
      }
    } else {
      skipped = applyPlan.wouldSkip;
    }

    if (commit) {
      await client.query("COMMIT");
      clearSpawnPointCache();
    } else {
      await client.query("ROLLBACK");
    }



// Build a small diff/preview list for UI. (Truncated to avoid huge payloads.)
const PREVIEW_LIMIT = 75;
const trunc = (arr: string[]) => arr.slice(0, PREVIEW_LIMIT);

const plannedAllSpawnIds: string[] = (plannedActions ?? [])
  .map((a: any) => String(a?.spawn?.spawnId ?? ""))
  .filter(Boolean);

const filteredSpawnIds: string[] = (budgetFilter.filteredActions ?? [])
  .filter((a: any) => a && a.kind === "place_spawn")
  .map((a: any) => String(a?.spawn?.spawnId ?? ""))
  .filter(Boolean);

const uniq = (arr: string[]) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const k = String(x ?? "");
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
};

const filteredUnique = uniq(filteredSpawnIds);
const plannedUnique = uniq(plannedAllSpawnIds);
const filteredSet = new Set<string>(filteredUnique);

const dupCounts = new Map<string, number>();
for (const sid of filteredSpawnIds) dupCounts.set(sid, (dupCounts.get(sid) ?? 0) + 1);
const duplicatePlannedSpawnIds = Array.from(dupCounts.entries())
  .filter(([_, n]) => n > 1)
  .map(([sid]) => sid)
  .sort((a, b) => a.localeCompare(b));

const insertSpawnIds: string[] = [];
const updateSpawnIds: string[] = [];
const skipSpawnIds: string[] = [];

for (const sid of filteredUnique) {
  const exists = effectiveExistingSpawnIds.has(sid);
  if (exists) {
    if (updateExisting) updateSpawnIds.push(sid);
    else skipSpawnIds.push(sid);
  } else {
    insertSpawnIds.push(sid);
  }
}

// "Dropped" means planned but not present after budget filtering (approx; duplicates collapse to uniq).
const droppedPlannedSpawnIds = plannedUnique.filter((sid) => !filteredSet.has(sid));

const deleteSpawnIds = !append
  ? [...existingBrainSpawnIds].map((s: any) => String(s ?? "")).filter(Boolean).sort((a, b) => a.localeCompare(b))
  : [];

const opsPreview: MotherBrainOpsPreview = {
  limit: PREVIEW_LIMIT,
  truncated:
    deleteSpawnIds.length > PREVIEW_LIMIT ||
    insertSpawnIds.length > PREVIEW_LIMIT ||
    updateSpawnIds.length > PREVIEW_LIMIT ||
    skipSpawnIds.length > PREVIEW_LIMIT ||
    duplicatePlannedSpawnIds.length > PREVIEW_LIMIT ||
    droppedPlannedSpawnIds.length > PREVIEW_LIMIT,
  deleteSpawnIds: deleteSpawnIds.length ? trunc(deleteSpawnIds) : undefined,
  insertSpawnIds: insertSpawnIds.length ? trunc(insertSpawnIds) : undefined,
  updateSpawnIds: updateSpawnIds.length ? trunc(updateSpawnIds) : undefined,
  skipSpawnIds: skipSpawnIds.length ? trunc(skipSpawnIds) : undefined,
  duplicatePlannedSpawnIds: duplicatePlannedSpawnIds.length ? trunc(duplicatePlannedSpawnIds) : undefined,
  droppedPlannedSpawnIds: droppedPlannedSpawnIds.length ? trunc(droppedPlannedSpawnIds) : undefined,
};

    // Compute protected IDs (editor-owned or locked) for preview visibility.
    const protectIds = Array.from(new Set([...(opsPreview.deleteSpawnIds ?? []), ...(opsPreview.updateSpawnIds ?? [])]));
    if (protectIds.length) {
      const pr = await client.query(
        `SELECT spawn_id FROM spawn_points WHERE shard_id = $1 AND spawn_id = ANY($2::text[]) AND (is_locked = TRUE OR owner_kind = 'editor')`,
        [shardId, protectIds],
      );
      const pset = new Set((pr.rows ?? []).map((r) => String(r.spawn_id)));
      const pDel = (opsPreview.deleteSpawnIds ?? []).filter((id) => pset.has(String(id)));
      const pUpd = (opsPreview.updateSpawnIds ?? []).filter((id) => pset.has(String(id)));
      if (pDel.length) opsPreview.protectedDeleteSpawnIds = trunc(pDel);
      if (pUpd.length) opsPreview.protectedUpdateSpawnIds = trunc(pUpd);
      if (pDel.length > PREVIEW_LIMIT || pUpd.length > PREVIEW_LIMIT) opsPreview.truncated = true;
    }

    const wouldDelete = append ? 0 : existingBrainIds.length;
    const out: MotherBrainWaveResponse = commit
      ? {
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
        }
      : {
          kind: "mother_brain.wave",
          summary: { total: wouldDelete + applyPlan.wouldInsert + applyPlan.wouldUpdate },
          ok: true,
          wouldDelete: append ? 0 : existingBrainIds.length,
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

    res.json(out);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    res.status(500).json({ ok: false, error: (err as any)?.message ?? String(err) });
  } finally {
    client.release();
  }
});

router.post("/mother_brain/wipe", async (req, res) => {
  const body: MotherBrainWipeRequest = (req.body ?? {}) as any;

  const shardId = strOrNull(body.shardId) ?? "prime_shard";
  const bounds = strOrNull(body.bounds) ?? "-1..1,-1..1";
  const cellSize = Number(body.cellSize ?? 64);
  const borderMargin = Math.max(0, Math.min(25, Number(body.borderMargin ?? 0)));
  const theme = strOrNull(body.theme);
  const epoch = body.epoch != null && Number.isFinite(Number(body.epoch)) ? Number(body.epoch) : null;
  const commit = Boolean(body.commit ?? false);
  const wantList = Boolean(body.list ?? false);
  const limit = Math.max(1, Math.min(500, Number(body.limit ?? 25)));

  let parsedBounds: CellBounds;
  let box: WorldBox;

  try {
    parsedBounds = parseCellBounds(bounds);
    box = toWorldBox(parsedBounds, Number.isFinite(cellSize) ? cellSize : 64, borderMargin);
  } catch (err: any) {
    res.status(400).json({
      ok: false,
      shardId,
      bounds,
      cellSize: Number.isFinite(cellSize) ? cellSize : 64,
      borderMargin,
      theme,
      epoch,
      commit,
      error: String(err?.message ?? "bad_bounds"),
    } satisfies MotherBrainWipeResponse);
    return;
  }

  try {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `
        SELECT id, spawn_id, type, proto_id, region_id
        FROM spawn_points
        WHERE shard_id = $1
          AND spawn_id LIKE 'brain:%'
          AND x >= $2 AND x <= $3
          AND z >= $4 AND z <= $5
        `,
        [shardId, box.minX, box.maxX, box.minZ, box.maxZ],
      );

      const rows = (existing.rows ?? []).map((r: any) => ({
        id: Number(r.id),
        spawnId: String(r.spawn_id ?? ""),
        type: String(r.type ?? ""),
        protoId: strOrNull(r.proto_id),
        regionId: strOrNull(r.region_id),
      }));

      const bySpawnId = new Map<string, { id: number; row: MotherBrainListRow }>();
      for (const r of rows) {
        if (!r.spawnId) continue;
        if (!Number.isFinite(r.id)) continue;
        bySpawnId.set(r.spawnId, {
          id: r.id,
          row: { spawnId: r.spawnId, type: r.type, protoId: r.protoId, regionId: r.regionId },
        });
      }

      const plan = computeBrainWipePlan({
        existingBrainSpawnIdsInBox: bySpawnId.keys(),
        theme,
        epoch,
      });

      const selectedSpawnIds = (plan.selected ?? []).slice();
      selectedSpawnIds.sort((a, b) => a.localeCompare(b));

      const ids: number[] = [];
      const listRows: MotherBrainListRow[] = [];
      for (const sid of selectedSpawnIds) {
        const hit = bySpawnId.get(sid);
        if (!hit) continue;
        ids.push(hit.id);
        if (wantList && listRows.length < limit) listRows.push(hit.row);
      }

      const wouldDelete = ids.length;
      let deleted = 0;


const PREVIEW_LIMIT = 75;
const deleteSpawnIds = selectedSpawnIds.slice();
const opsPreview: MotherBrainOpsPreview = {
  limit: PREVIEW_LIMIT,
  truncated: deleteSpawnIds.length > PREVIEW_LIMIT,
  deleteSpawnIds: deleteSpawnIds.length ? deleteSpawnIds.slice(0, PREVIEW_LIMIT) : undefined,
};

    // Compute protected IDs (editor-owned or locked) for preview visibility.
    const protectIds = Array.from(new Set([...(opsPreview.deleteSpawnIds ?? []), ...(opsPreview.updateSpawnIds ?? [])]));
    if (protectIds.length) {
      const pr = await db.query(
        `SELECT spawn_id FROM spawn_points WHERE shard_id = $1 AND spawn_id = ANY($2::text[]) AND (is_locked = TRUE OR owner_kind = 'editor')`,
        [shardId, protectIds],
      );
      const pset = new Set((pr.rows ?? []).map((r: any) => String(r.spawn_id)));
      const pDel = (opsPreview.deleteSpawnIds ?? []).filter((id: any) => pset.has(String(id)));
      const pUpd = (opsPreview.updateSpawnIds ?? []).filter((id: any) => pset.has(String(id)));
      // Keep this inline (vs a helper) so this block can't ever end up
      // below a const helper definition during future refactors.
      if (pDel.length)
        opsPreview.protectedDeleteSpawnIds = (pDel as any).slice(0, PREVIEW_LIMIT);
      if (pUpd.length)
        opsPreview.protectedUpdateSpawnIds = (pUpd as any).slice(0, PREVIEW_LIMIT);
      if (pDel.length > PREVIEW_LIMIT || pUpd.length > PREVIEW_LIMIT) opsPreview.truncated = true;
    }


const expectedConfirmToken =
  commit && wouldDelete > 0
    ? makeConfirmToken("WIPE", shardId, {
        bounds,
        cellSize: Number.isFinite(cellSize) ? cellSize : 64,
        borderMargin,
        theme,
        epoch,
        box,
        deleteScope: "brain:* selection (filtered by theme/epoch)",
      })
    : null;

const confirm = strOrNull((body as any).confirm);

if (commit && expectedConfirmToken && confirm !== expectedConfirmToken) {
  await client.query("ROLLBACK");
  const payload: MotherBrainWipeResponse = {
    kind: "mother_brain.wipe",
    ok: false,
    error: "confirm_required",
    expectedConfirmToken,
    shardId,
    bounds,
    cellSize: Number.isFinite(cellSize) ? cellSize : 64,
    borderMargin,
    theme,
    epoch,
    commit,
    wouldDelete,
    opsPreview,
    ...(wantList ? { list: listRows } : null),
  };
  res.status(409).json(payload);
  return;
}


      if (commit && ids.length > 0) {
        await client.query(`DELETE FROM spawn_points WHERE id = ANY($1::int[])`, [ids]);
        deleted = ids.length;
      }

      if (commit) {
        await client.query("COMMIT");
        clearSpawnPointCache();
      } else {
        await client.query("ROLLBACK");
      }

      const payload: MotherBrainWipeResponse = commit
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

      res.json(payload);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] mother_brain/wipe error", err);
    res.status(500).json({
      ok: false,
      shardId,
      bounds,
      cellSize: Number.isFinite(cellSize) ? cellSize : 64,
      borderMargin,
      theme,
      epoch,
      commit,
      error: "internal_error",
    } satisfies MotherBrainWipeResponse);
  }
});

export default router;