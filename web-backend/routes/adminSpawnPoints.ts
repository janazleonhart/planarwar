// web-backend/routes/adminSpawnPoints.ts

import { Router } from "express";
import { createHash } from "crypto";
import {
  boolish,
  coerceSnapshotSpawns,
  listStoredSnapshots,
  makeSnapshotId,
  normalizeSnapshotTags,
  readStoredSnapshotById,
  safeSnapshotName,
  safeSnapshotNotes,
  type CellBounds,
  type SnapshotSpawnRow,
  type SpawnSliceSnapshot,
  type StoredSpawnSnapshotDoc,
} from "./adminSpawnPoints/snapshotStore";
import {
  getSpawnSnapshotsRetentionStatus,
  startSpawnSnapshotsRetentionScheduler,
} from "./adminSpawnPoints/snapshotRetention";
import {
  buildSnapshotBulkDeletePlan,
  buildSnapshotPurgePlan,
  deleteSnapshotFile,
  deleteSnapshotFiles,
  prepareSnapshotDeleteConfirm,
} from "./adminSpawnPoints/snapshotDeleteOps";
import {
  duplicateStoredSnapshotFromBody,
  updateStoredSnapshotFromBody,
} from "./adminSpawnPoints/snapshotWriteOps";
import {
  buildSnapshotFromQuery,
  filterAndSortSnapshots,
  makeSnapshotQueryFilename,
  saveStoredSnapshotDoc,
} from "./adminSpawnPoints/snapshotResponses";
import {
  parseCellBounds,
  toWorldBox,
  type AdminSummary,
  type DuplicateSnapshotResponse,
  type MotherBrainListRow,
  type MotherBrainOpsPreview,
  type MotherBrainStatusResponse,
  type MotherBrainWaveBudgetConfig,
  type MotherBrainWaveRequest,
  type MotherBrainWaveResponse,
  type MotherBrainWipeRequest,
  type MotherBrainWipeResponse,
  type ReasonCode,
  type ReasonDetail,
  type SpawnSliceOpsPreview,
  type TownBaselineOpsPreview,
  type WorldBox,
} from "./adminSpawnPoints/opsPreview";
import {
  applyProtectedPreviewRows,
  buildMotherBrainWaveOpsPreview,
  buildMotherBrainWipeOpsPreview,
  buildWipeListRows,
} from "./adminSpawnPoints/motherBrainOps";
import {
  buildTownBaselineErrorResponse,
  buildTownBaselineSuccessResponse,
} from "./adminSpawnPoints/townBaselineResponses";
import { applyTownBaselinePlan } from "./adminSpawnPoints/townBaselineApply";
import {
  applyRestoreSnapshot,
  computeRestoreExtraTargetDiff,
  planRestoreSnapshot,
  preloadExistingSpawnIds,
  preloadProtectedSpawnMap,
} from "./adminSpawnPoints/restoreSnapshot";
import {
  deleteEditableSpawnPoints,
  moveEditableSpawnPoints,
} from "./adminSpawnPoints/bulkMutationOps";
import {
  applyBulkOwnershipAction,
  buildWhereFromQueryFilters,
  planBulkOwnershipAction,
  type BulkOwnershipOpsPreview,
  type BulkOwnershipQuery,
  type BulkOwnershipQueryAction,
  type BulkOwnershipQueryRequest,
  type BulkOwnershipQueryResponse,
} from "./adminSpawnPoints/bulkOwnershipOps";
import {
  applySingleOwnershipAction,
  readSpawnPointRowById,
  type SpawnOwnerKind,
} from "./adminSpawnPoints/singleOwnershipOps";
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
import { loadProtoOptionsPayload } from "./adminSpawnPoints/protoCatalogOps";
import {
  buildSpawnPointListQuery,
  loadSnapshotRowsByQuery,
  parseSpawnPointQueryFilters,
} from "./adminSpawnPoints/snapshotQueryFilters";
import {
  parseSnapshotCaptureRequest,
  parseSnapshotQueryRequest,
  parseSnapshotSaveQueryRequest,
  parseStoredSnapshotListRequest,
} from "./adminSpawnPoints/snapshotRequestParsers";

const router = Router();

type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";

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
  | "spawn_points.snapshots.purge"
  | "spawn_points.snapshots.retention_status"
  | "spawn_points.restore"
  | "town_baseline.plan"
  | "town_baseline.apply"
  | "mother_brain.status"
  | "mother_brain.wave"
  | "mother_brain.wipe";

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

router.get("/proto_options", async (_req, res) => {
  try {
    const payload = await loadProtoOptionsPayload({
      cwd: process.cwd(),
      dirname: __dirname,
      getStationProtoIdsForTier,
    });
    return res.json({ ok: true, ...payload });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/", async (req, res) => {
  try {
    const filters = parseSpawnPointQueryFilters(req.query, { numOrNull, strOrNull, normalizeAuthority });
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 200)));
    const { sql, args } = buildSpawnPointListQuery({
      filters,
      limit,
      helpers: { numOrNull, strOrNull, normalizeAuthority },
    });

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
    await applySingleOwnershipAction({ id, action: "adopt", ownerId });

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
    await applySingleOwnershipAction({ id, action: "release", spawnId });

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

    await applySingleOwnershipAction({ id, action: "lock" });

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

    await applySingleOwnershipAction({ id, action: "unlock" });

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
    const { whereSql, args } = buildWhereFromQueryFilters({
      shardId,
      query: q,
      numOrNull,
      strOrNull,
      normalizeAuthority,
    });

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

    const plan = planBulkOwnershipAction({
      found: found as any[],
      action,
      ownerId: strOrNull(body.ownerId),
      shardId,
      whereSql,
      whereArgs: args,
      strOrNull,
      isSpawnEditable: (spawnId: string) => isSpawnEditable(String(spawnId ?? "")),
      makeConfirmToken,
    });

    const commit = Boolean(body.commit);
    const confirm = strOrNull(body.confirm);

    if (commit && plan.expectedConfirmToken && confirm !== plan.expectedConfirmToken) {
      return res.status(409).json({
        kind: "spawn_points.bulk_ownership",
        ok: false,
        action,
        shardId,
        matched: found.length,
        wouldChange: plan.targetIds.length,
        skippedReadOnly: plan.readOnlySpawnIds.length,
        skippedNoOp: plan.noOpCount,
        error: "confirm_required",
        expectedConfirmToken: plan.expectedConfirmToken,
        opsPreview: plan.opsPreview,
      } satisfies BulkOwnershipQueryResponse);
    }

    if (!commit) {
      return res.json({
        kind: "spawn_points.bulk_ownership",
        ok: true,
        action,
        shardId,
        matched: found.length,
        wouldChange: plan.targetIds.length,
        skippedReadOnly: plan.readOnlySpawnIds.length,
        skippedNoOp: plan.noOpCount,
        expectedConfirmToken: plan.expectedConfirmToken ?? undefined,
        opsPreview: plan.opsPreview,
      } satisfies BulkOwnershipQueryResponse);
    }

    if (plan.targetIds.length === 0) {
      return res.json({
        kind: "spawn_points.bulk_ownership",
        ok: true,
        action,
        shardId,
        matched: found.length,
        wouldChange: 0,
        skippedReadOnly: plan.readOnlySpawnIds.length,
        skippedNoOp: plan.noOpCount,
        commit: true,
        changed: 0,
        opsPreview: plan.opsPreview,
      } satisfies BulkOwnershipQueryResponse);
    }

    const changed = await applyBulkOwnershipAction({
      db,
      shardId,
      action,
      targetIds: plan.targetIds,
      ownerId: strOrNull(body.ownerId),
    });

    clearSpawnPointCache();

    return res.json({
      kind: "spawn_points.bulk_ownership",
      ok: true,
      action,
      shardId,
      matched: found.length,
      wouldChange: plan.targetIds.length,
      skippedReadOnly: plan.readOnlySpawnIds.length,
      skippedNoOp: plan.noOpCount,
      commit: true,
      changed,
      opsPreview: plan.opsPreview,
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

    const result = await deleteEditableSpawnPoints({
      shardId,
      ids,
      isSpawnEditable,
    });

    clearSpawnPointCache();

    res.json({
      ok: true,
      deleted: result.deleted,
      skipped: result.skipped,
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

    const result = await moveEditableSpawnPoints({
      shardId,
      ids,
      dx,
      dy,
      dz,
      isSpawnEditable,
    });

    clearSpawnPointCache();

    res.json({
      ok: true,
      moved: result.moved,
      skipped: result.skipped,
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

function getActorIdFromReq(req: unknown): string | null {
  const sub = String((req as any)?.auth?.sub ?? "").trim();
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

    const response: TownBaselinePlanResponse = buildTownBaselineSuccessResponse({
      kind: "town_baseline.plan",
      plan,
      isSpawnEditable,
    });

    return res.json(response);
  } catch (err: any) {
    const shardId = strOrNull(body.shardId) ?? "prime_shard";
    const response: TownBaselinePlanResponse = buildTownBaselineErrorResponse({
      shardId,
      bounds: strOrNull(body.bounds) ?? "",
      cellSize: Number.isFinite(Number(body.cellSize)) ? Number(body.cellSize) : 64,
      seedBase: normalizeSeedBase(body.seedBase),
      spawnIdMode: body.spawnIdMode === "legacy" ? "legacy" : "seed",
      includeStations: body.includeStations === true,
      respectTownTierStations: body.respectTownTierStations === true,
      townTierOverride: body.townTierOverride != null ? numOrNull(body.townTierOverride) : null,
      error: String(err?.message ?? "internal_error"),
    });

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
      const response: TownBaselinePlanResponse = buildTownBaselineSuccessResponse({
        kind: "town_baseline.apply",
        plan,
        isSpawnEditable,
      });
      return res.json(response);
    }

    const { inserted, updated, skipped, skippedReadOnly, skippedProtected } = await applyTownBaselinePlan({
      plan,
      isSpawnEditable,
    });

    clearSpawnPointCache();

    const response: TownBaselinePlanResponse = buildTownBaselineSuccessResponse({
      kind: "town_baseline.apply",
      plan,
      isSpawnEditable,
      counts: {
        wouldInsert: inserted,
        wouldUpdate: updated,
        wouldSkip: skipped,
        skippedReadOnly,
        skippedProtected,
      },
    });

    return res.json(response);
  } catch (err: any) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // ignore
    }

    const shardId = strOrNull(body.shardId) ?? "prime_shard";
    const response: TownBaselinePlanResponse = buildTownBaselineErrorResponse({
      shardId,
      bounds: strOrNull(body.bounds) ?? "",
      cellSize: Number.isFinite(Number(body.cellSize)) ? Number(body.cellSize) : 64,
      seedBase: normalizeSeedBase(body.seedBase),
      spawnIdMode: body.spawnIdMode === "legacy" ? "legacy" : "seed",
      includeStations: body.includeStations === true,
      respectTownTierStations: body.respectTownTierStations === true,
      townTierOverride: body.townTierOverride != null ? numOrNull(body.townTierOverride) : null,
      error: String(err?.message ?? "internal_error"),
    });

    return res.status(500).json(response);
  }
});

// Mother Brain façade endpoints
// ------------------------------

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
    const { shardId, boundsRaw, types, cellSize, pad } = parseSnapshotCaptureRequest(req.body, {
      boolish,
      numOrNull,
      strOrNull,
      normalizeAuthority,
    });
    if (!boundsRaw) return res.status(400).json({ kind: "spawn_points.snapshot", ok: false, error: "missing_bounds" });
    if (!types.length) return res.status(400).json({ kind: "spawn_points.snapshot", ok: false, error: "missing_types" });

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
    const { filters, cellSize, pad, maxRows } = parseSnapshotQueryRequest(req.body, {
      boolish,
      numOrNull,
      strOrNull,
      normalizeAuthority,
    });

    const { total, spawns } = await loadSnapshotRowsByQuery({
      db,
      filters,
      maxRows,
      helpers: { numOrNull, strOrNull, normalizeAuthority },
    });
    if (total > maxRows) {
      return res.status(400).json({
        kind: "spawn_points.snapshot_query",
        ok: false,
        error: "too_many_rows",
        total,
        max: maxRows,
      });
    }

    const snapshot = buildSnapshotFromQuery({ shardId: filters.shardId, spawns, cellSize, pad, typeQ: filters.type ?? null });
    const filename = makeSnapshotQueryFilename({
      shardId: filters.shardId,
      regionId: filters.regionId ?? null,
      x: filters.x ?? null,
      z: filters.z ?? null,
      radius: filters.radius ?? null,
    });

    return res.json({ kind: "spawn_points.snapshot_query", ok: true, filename, snapshot, total: spawns.length });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] snapshot_query error", err);
    return res.status(500).json({ kind: "spawn_points.snapshot_query", ok: false, error: err?.message || String(err) });
  }
});


// POST /api/admin/spawn_points/snapshots/save_query
router.post("/snapshots/save_query", async (req, res) => {
  try {
    const { nameRaw, tags, notes, filters, cellSize, pad, maxRows } = parseSnapshotSaveQueryRequest(req.body, {
      boolish,
      numOrNull,
      strOrNull,
      normalizeAuthority,
    });
    if (!nameRaw) return res.status(400).json({ kind: "spawn_points.snapshots.save_query", ok: false, error: "missing_name" });

    const { total, spawns } = await loadSnapshotRowsByQuery({
      db,
      filters,
      maxRows,
      helpers: { numOrNull, strOrNull, normalizeAuthority },
    });
    if (total > maxRows) {
      return res.status(400).json({
        kind: "spawn_points.snapshots.save_query",
        ok: false,
        error: "too_many_rows",
        total,
        max: maxRows,
      });
    }

    const snapshot = buildSnapshotFromQuery({ shardId: filters.shardId, spawns, cellSize, pad, typeQ: filters.type ?? null });
    const name = safeSnapshotName(nameRaw);
    const id = makeSnapshotId(name, filters.shardId, snapshot.bounds, snapshot.types);
    const savedAt = new Date().toISOString();

    const doc: StoredSpawnSnapshotDoc = {
      kind: "admin.stored-spawn-snapshot",
      version: 3,
      id,
      name,
      savedAt,
      tags,
      notes,
      isArchived: false,
      isPinned: false,
      expiresAt: null,
      snapshot,
    };

    const meta = await saveStoredSnapshotDoc(doc);
    return res.json({ kind: "spawn_points.snapshots.save_query", ok: true, snapshot: meta, total: spawns.length });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] snapshots save_query error", err);
    return res
      .status(500)
      .json({ kind: "spawn_points.snapshots.save_query", ok: false, error: err?.message || String(err) });
  }
});

// GET /api/admin/spawn_points/snapshots
// Query:
//   sort=newest|oldest|name|pinned
//   tag=<tag>
//   q=<search in name/tags/notes>
//   pinnedOnly=1
//   includeArchived=1
//   includeExpired=1
//   limit=250
router.get("/snapshots", async (req, res) => {
  try {
    const snapshots = filterAndSortSnapshots({
      snapshots: await listStoredSnapshots(),
      ...parseStoredSnapshotListRequest((req as any).query, {
        boolish,
        numOrNull,
        strOrNull,
        normalizeAuthority,
      }),
    });

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

    const { shardId, boundsRaw, types, cellSize, pad } = parseSnapshotCaptureRequest(req.body, {
      boolish,
      numOrNull,
      strOrNull,
      normalizeAuthority,
    });
    if (!boundsRaw) return res.status(400).json({ kind: "spawn_points.snapshots.save", ok: false, error: "missing_bounds" });
    if (!types.length) return res.status(400).json({ kind: "spawn_points.snapshots.save", ok: false, error: "missing_types" });

    const { snapshot } = await computeSpawnSliceSnapshot({ shardId, boundsRaw, cellSize, pad, types });

    const name = safeSnapshotName(nameRaw);
    const id = makeSnapshotId(name, shardId, snapshot.bounds, snapshot.types);
    const savedAt = new Date().toISOString();

    const tags = normalizeSnapshotTags(req.body?.tags);
    const notes = safeSnapshotNotes(req.body?.notes);

    const doc: StoredSpawnSnapshotDoc = {
      kind: "admin.stored-spawn-snapshot",
      version: 3,
      id,
      name,
      savedAt,
      tags,
      notes,
      isArchived: false,
      isPinned: false,
      expiresAt: null,
      snapshot,
    };

    const meta = await saveStoredSnapshotDoc(doc);
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
// Body: { name?, tags?, notes?, isArchived?, isPinned?, expiresAt? }
// - expiresAt accepts: ISO string, null (clear), or a number/"N" meaning "expire in N days"
router.put("/snapshots/:id", async (req, res) => {
  try {
    const id = strOrNull(req.params?.id);
    if (!id) return res.status(400).json({ kind: "spawn_points.snapshots.update", ok: false, error: "missing_id" });

    const { doc } = await readStoredSnapshotById(id);

    const meta = await updateStoredSnapshotFromBody({
      doc,
      id,
      body: req.body,
    });

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

    const meta = await duplicateStoredSnapshotFromBody({
      doc,
      body: req.body,
    });

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

    // Destructive action safety gate: require an explicit confirm token.
    // This avoids accidental deletes from mis-clicks or stale UI state.
    const confirm = String((req.query as any)?.confirm ?? "").trim() || null;

    const { expectedConfirmToken } = await prepareSnapshotDeleteConfirm(id);

    if (!confirm || confirm !== expectedConfirmToken) {
      return res.status(409).json({
        kind: "spawn_points.snapshots.delete",
        ok: false,
        error: "confirm_required",
        expectedConfirmToken,
        id,
      });
    }

    await deleteSnapshotFile(id);

    return res.json({ kind: "spawn_points.snapshots.delete", ok: true, id });
  } catch (err: any) {
    const msg = err.message || String(err);
    const status = /no such file/i.test(msg) || /ENOENT/i.test(msg) ? 404 : 500;
    console.error("[ADMIN/SPAWN_POINTS] snapshots delete error", err);
    return res.status(status).json({ kind: "spawn_points.snapshots.delete", ok: false, error: msg });
  }
});


// POST /api/admin/spawn_points/snapshots/bulk_delete
// Body:
//   ids: string[]
//   commit?: boolean
//   includePinned?: boolean          (also delete pinned; default false)
//   confirm?: string                (required for commit; returned by preview)
router.post("/snapshots/bulk_delete", async (req, res) => {
  try {
    const commit = Boolean(req.body?.commit);
    const includePinned = Boolean(req.body?.includePinned);
    const confirm = String(req.body?.confirm ?? "").trim() || null;

    const idsRaw = Array.isArray(req.body?.ids) ? (req.body.ids as any[]) : [];
    const ids: string[] = [];
    const seen = new Set<string>();

    // Hard cap: bulk delete is an operator tool, not a data shredder.
    for (const v of idsRaw) {
      const id = String(v ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= 500) break;
    }

    if (!ids.length) {
      return res.status(400).json({ kind: "spawn_points.snapshots.bulk_delete", ok: false, error: "missing_ids" });
    }

    const plan = await buildSnapshotBulkDeletePlan({ ids, includePinned });
    if (!commit) {
      return res.json({
        kind: "spawn_points.snapshots.bulk_delete",
        ok: true,
        commit: false,
        includePinned: plan.includePinned,
        requested: plan.requested,
        found: plan.found,
        missing: plan.missing,
        missingIds: plan.missingIds.slice(0, 250),
        skippedPinned: plan.skippedPinned,
        activeCount: plan.activeCount,
        count: plan.count,
        bytes: plan.bytes,
        ids: plan.ids,
        confirmToken: plan.confirmToken,
      });
    }

    if (!confirm || confirm !== plan.confirmToken) {
      return res.status(400).json({
        kind: "spawn_points.snapshots.bulk_delete",
        ok: false,
        commit: true,
        requiresConfirm: true,
        includePinned: plan.includePinned,
        requested: plan.requested,
        found: plan.found,
        missing: plan.missing,
        missingIds: plan.missingIds.slice(0, 250),
        skippedPinned: plan.skippedPinned,
        activeCount: plan.activeCount,
        count: plan.count,
        bytes: plan.bytes,
        ids: plan.ids.slice(0, 250),
        confirmToken: plan.confirmToken,
      });
    }

    const { deleted, failed } = await deleteSnapshotFiles(plan.ids);

    return res.json({
      kind: "spawn_points.snapshots.bulk_delete",
      ok: true,
      commit: true,
      includePinned: plan.includePinned,
      requested: plan.requested,
      found: plan.found,
      missing: plan.missing,
      missingIds: plan.missingIds.slice(0, 250),
      skippedPinned: plan.skippedPinned,
      activeCount: plan.activeCount,
      deleted,
      failed,
      bytes: plan.bytes,
      ids: plan.ids.slice(0, 250),
    });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] snapshots bulk_delete error", err);
    return res.status(500).json({
      kind: "spawn_points.snapshots.bulk_delete",
      ok: false,
      error: err?.message || String(err),
    });
  }
});


// POST /api/admin/spawn_points/snapshots/purge
// Body:
//   commit?: boolean
//   includeArchived?: boolean        (also purge archived snapshots, gated by olderThanDays)
//   includePinned?: boolean          (also purge pinned snapshots; default false)
//   olderThanDays?: number          (only for archived purge; default 30)
//   confirm?: string                (required for commit; returned by preview)
router.post("/snapshots/purge", async (req, res) => {
  try {
    const commit = Boolean(req.body?.commit);
    const includeArchived = Boolean(req.body?.includeArchived);
    const includePinned = Boolean(req.body?.includePinned);
    const olderThanDaysRaw = Number(req.body?.olderThanDays);
    const olderThanDays = Number.isFinite(olderThanDaysRaw) ? Math.max(0, Math.min(3650, Math.floor(olderThanDaysRaw))) : 30;

    const confirm = String(req.body?.confirm ?? "").trim() || null;

    const plan = await buildSnapshotPurgePlan({ includeArchived, includePinned, olderThanDays });
    if (!commit) {
      return res.json({
        kind: "spawn_points.snapshots.purge",
        ok: true,
        commit: false,
        includeArchived: plan.includeArchived,
        includePinned: plan.includePinned,
        olderThanDays: plan.olderThanDays,
        skippedPinned: plan.skippedPinned,
        count: plan.count,
        bytes: plan.bytes,
        ids: plan.ids,
        confirmToken: plan.confirmToken,
      });
    }

    if (!confirm || confirm !== plan.confirmToken) {
      return res.status(400).json({
        kind: "spawn_points.snapshots.purge",
        ok: false,
        commit: true,
        requiresConfirm: true,
        includeArchived: plan.includeArchived,
        includePinned: plan.includePinned,
        olderThanDays: plan.olderThanDays,
        skippedPinned: plan.skippedPinned,
        count: plan.count,
        bytes: plan.bytes,
        ids: plan.ids.slice(0, 250),
        confirmToken: plan.confirmToken,
      });
    }

    const { deleted, failed } = await deleteSnapshotFiles(plan.ids);

    return res.json({
      kind: "spawn_points.snapshots.purge",
      ok: true,
      commit: true,
      includeArchived: plan.includeArchived,
      includePinned: plan.includePinned,
      olderThanDays: plan.olderThanDays,
      skippedPinned: plan.skippedPinned,
      deleted,
      failed,
      bytes: plan.bytes,
      ids: plan.ids.slice(0, 250),
    });
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] snapshots purge error", err);
    return res.status(500).json({
      kind: "spawn_points.snapshots.purge",
      ok: false,
      error: err?.message || String(err),
    });
  }
});


// GET /api/admin/spawn_points/snapshots/retention_status
router.get("/snapshots/retention_status", (_req, res) => {
  try {
    return res.json(getSpawnSnapshotsRetentionStatus());
  } catch (err: any) {
    return res.status(500).json({
      kind: "spawn_points.snapshots.retention_status",
      ok: false,
      error: err?.message || String(err),
    });
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

    const existingSet = await preloadExistingSpawnIds(targetShard, spawnIds);

    const protectedMap = await preloadProtectedSpawnMap({
      targetShard,
      spawnIds,
      updateExisting,
      allowProtected,
    });

    const { extraTargetIds, extraTargetCount } = await computeRestoreExtraTargetDiff({
      targetShard,
      snapshotBounds,
      snapshotCellSize,
      snapshotPad,
      snapshotTypes,
      spawnIds,
      limit: 75,
    });

    const { insertIds, updateIds, skipIds, readOnlyIds, opsPreview } = planRestoreSnapshot({
      spawns,
      existingSet,
      protectedMap,
      updateExisting,
      allowBrainOwned,
      allowProtected,
      extraTargetIds,
      extraTargetCount,
      limit: 75,
    });

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

    const { inserted, updated, skipped, skippedReadOnly, skippedProtected } = await applyRestoreSnapshot({
      targetShard,
      spawns,
      existingSet,
      protectedMap,
      updateExisting,
      allowBrainOwned,
      allowProtected,
      commit,
    });

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


const opsPreview: MotherBrainOpsPreview = buildMotherBrainWaveOpsPreview({
  plannedActions: plannedActions as any[],
  filteredActions: budgetFilter.filteredActions as any[],
  effectiveExistingSpawnIds,
  existingBrainSpawnIds,
  append,
  updateExisting,
});

    const protectIds = Array.from(new Set([...(opsPreview.deleteSpawnIds ?? []), ...(opsPreview.updateSpawnIds ?? [])]));
    if (protectIds.length) {
      const pr = await client.query(
        `SELECT spawn_id, owner_kind, is_locked FROM spawn_points WHERE shard_id = $1 AND spawn_id = ANY($2::text[]) AND (is_locked = TRUE OR owner_kind = 'editor')`,
        [shardId, protectIds],
      );

      applyProtectedPreviewRows({
        opsPreview,
        rows: (pr.rows ?? []) as Array<{ spawn_id?: unknown; owner_kind?: unknown; is_locked?: unknown }>,
      });
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

      const { ids, listRows } = buildWipeListRows({
        selectedSpawnIds,
        bySpawnId,
        wantList,
        limit,
      });

      const wouldDelete = ids.length;
      let deleted = 0;

      const opsPreview: MotherBrainOpsPreview = buildMotherBrainWipeOpsPreview(selectedSpawnIds);

      const protectIds = Array.from(new Set([...(opsPreview.deleteSpawnIds ?? []), ...(opsPreview.updateSpawnIds ?? [])]));
      if (protectIds.length) {
        const pr = await db.query(
          `SELECT spawn_id, owner_kind, is_locked FROM spawn_points WHERE shard_id = $1 AND spawn_id = ANY($2::text[]) AND (is_locked = TRUE OR owner_kind = 'editor')`,
          [shardId, protectIds],
        );
        applyProtectedPreviewRows({
          opsPreview,
          rows: (pr.rows ?? []) as Array<{ spawn_id?: unknown; owner_kind?: unknown; is_locked?: unknown }>,
        });
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

export { startSpawnSnapshotsRetentionScheduler };

export default router;
