// web-backend/routes/adminSpawnPoints.ts

import { Router } from "express";
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
        town_tier
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
          (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
      `SELECT id, shard_id, spawn_id FROM spawn_points WHERE id = $1 LIMIT 1`,
      [id],
    );

    const found = row.rows?.[0];
    if (!found) return res.status(404).json({ ok: false, error: "not_found" });
    if (String(found.shard_id) !== shardId) return res.status(403).json({ ok: false, error: "shard_mismatch" });

    const spawnId = String(found.spawn_id ?? "");
    if (!isSpawnEditable(spawnId)) {
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

    // Enforce brain-readonly at server side (don’t trust UI).
    const rows = await db.query(
      `
      SELECT id, spawn_id
      FROM spawn_points
      WHERE shard_id = $1 AND id = ANY($2::int[])
      `,
      [shardId, ids],
    );

    const deletable = (rows.rows ?? [])
      .filter((r: any) => isSpawnEditable(String(r.spawn_id ?? "")))
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

    // Filter out brain-owned ids (server-side enforcement).
    const rows = await db.query(
      `
      SELECT id, spawn_id
      FROM spawn_points
      WHERE shard_id = $1 AND id = ANY($2::int[])
      `,
      [shardId, ids],
    );

    const movable = (rows.rows ?? [])
      .filter((r: any) => isSpawnEditable(String(r.spawn_id ?? "")))
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
      SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier
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
      if (!isSpawnEditable(sp.spawnId)) {
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
            (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
          (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
        `,
        [shardId, spawnId, type, archetype, protoId, variantId, p.x, y, p.z, regionId, townTier],
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
  shardId: string;
  bounds: string;
  cellSize: number;
  seedBase: string;
  spawnIdMode: "seed" | "legacy";
  includeStations: boolean;
  respectTownTierStations: boolean;
  townTierOverride: number | null;

  wouldInsert?: number;
  wouldUpdate?: number;
  wouldSkip?: number;
  skippedReadOnly?: number;

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
        SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier
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

  const planItems: TownBaselinePlanItem[] = plannedSpawns.map((sp) => {
    const ex = existingBySpawnId.get(sp.spawnId);
    if (!ex) {
      wouldInsert += 1;
      return { spawn: sp, op: "insert" };
    }

    if (sameSpawnRow(ex, sp)) {
      wouldSkip += 1;
      return { spawn: sp, op: "skip", existingId: Number(ex.id) || null };
    }

    wouldUpdate += 1;
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
        plan: plan.planItems,
      };
      return res.json(response);
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let skippedReadOnly = 0;

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
          SELECT id, shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier
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
              (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
            ],
          );
          inserted += 1;
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
};

type MotherBrainWaveResponse = {
  kind?: AdminApiKind;
  summary?: AdminSummary;
  ok: boolean;

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
};



type MotherBrainWipeRequest = {
  shardId?: string;
  bounds: string;
  cellSize?: number;
  borderMargin?: number;
  theme?: string | null;
  epoch?: number | null;
  commit?: boolean;
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

    const budgetReport = computeBrainWaveBudgetReport({
      existingBrainSpawnIdsInBox: existingBrainSpawnIds,
      append,
      theme,
      epoch,
      budget,
    });

    const budgetFilter = filterPlannedActionsToBudget({
      plannedActions: plannedActions as any,
      existingSpawnIds,
      updateExisting,
      allowedNewInserts: budgetReport.allowedNewInserts,
    });

    const applyPlan = computeBrainWaveApplyPlan({
      plannedActions: budgetFilter.filteredActions as any,
      existingSpawnIds,
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

        const exists = existingSpawnIds.has(sid);
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
          budget,
          budgetReport,
          budgetFilter,
          applyPlan,
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
          budget,
          budgetReport,
          budgetFilter,
          applyPlan,
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