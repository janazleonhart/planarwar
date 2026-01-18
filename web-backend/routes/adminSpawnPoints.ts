// web-backend/routes/adminSpawnPoints.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";
import { clearSpawnPointCache } from "../../worldcore/world/SpawnPointCache";
import { getSpawnAuthority, isSpawnEditable } from "../../worldcore/world/spawnAuthority";
import { planBrainWave } from "../../worldcore/sim/MotherBrainWavePlanner";

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

type MotherBrainWaveRequest = {
  shardId?: string;
  bounds: string;
  cellSize?: number;
  borderMargin?: number;
  seed?: string;
  epoch?: number;
  theme?: string;
  count?: number;
  append?: boolean;
  commit?: boolean;
};

type MotherBrainWaveResponse = {
  ok: boolean;
  shardId: string;
  bounds: string;
  cellSize: number;
  theme: string;
  epoch: number;
  commit: boolean;
  append: boolean;
  wouldInsert?: number;
  wouldDelete?: number;
  inserted?: number;
  deleted?: number;
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
  // brain:<epoch>:<theme>:...
  const parts = spawnId.split(":");
  if (parts.length < 3) return { epoch: null, theme: null };
  const epoch = Number(parts[1]);
  const theme = parts[2] ?? null;
  return { epoch: Number.isFinite(epoch) ? epoch : null, theme };
}

router.get("/mother_brain/status", async (req, res) => {
  try {
    const shardId = strOrNull(req.query.shardId) ?? "prime_shard";
    const bounds = strOrNull(req.query.bounds) ?? "-1..1,-1..1";
    const cellSize = Number(req.query.cellSize ?? 64);
    const themeQ = strOrNull(req.query.theme);
    const epochQ = strOrNull(req.query.epoch);
    const wantList = String(req.query.list ?? "").toLowerCase() === "true";
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

  const shardId = strOrNull(body.shardId) ?? "prime_shard";
  const bounds = strOrNull(body.bounds) ?? "-1..1,-1..1";
  const cellSize = Number(body.cellSize ?? 64);
  const borderMargin = Math.max(0, Math.min(10, Number(body.borderMargin ?? 0)));
  const seed = strOrNull(body.seed) ?? "seed:mother_brain";
  const epoch = Number.isFinite(Number(body.epoch)) ? Number(body.epoch) : 0;
  const theme = strOrNull(body.theme) ?? "bandits";
  const count = Math.max(1, Math.min(5000, Number(body.count ?? 8)));
  const append = Boolean(body.append ?? false);
  const commit = Boolean(body.commit ?? false);

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
      cellSize,
      theme,
      epoch,
      commit,
      append,
      error: String(err?.message ?? "bad_bounds"),
    } satisfies MotherBrainWaveResponse);
    return;
  }

  try {
    const client = await db.connect();
    let wouldDelete = 0;
    let wouldInsert = 0;
    let inserted = 0;

    try {
      await client.query("BEGIN");

      if (!append) {
        const existing = await client.query(
          `
          SELECT id
          FROM spawn_points
          WHERE shard_id = $1
            AND spawn_id LIKE 'brain:%'
            AND x >= $2 AND x <= $3
            AND z >= $4 AND z <= $5
          `,
          [shardId, box.minX, box.maxX, box.minZ, box.maxZ],
        );

        const ids: number[] = (existing.rows ?? [])
          .map((r: any) => Number(r.id))
          .filter((n: number) => Number.isFinite(n));
        wouldDelete = ids.length;

        if (ids.length > 0) {
          await client.query(`DELETE FROM spawn_points WHERE id = ANY($1::int[])`, [ids]);
        }
      }

      const planned: any[] = await (planBrainWave as any)({
        shardId,
        bounds,
        cellSize: Number.isFinite(cellSize) ? cellSize : 64,
        borderMargin,
        seed,
        epoch,
        theme,
        count,
      });

      const placeRows = (planned ?? [])
        .map((a: any) => {
          // Most of our planners emit kind: 'place_spawn' with flat fields.
          const kind = a?.kind ?? "";
          if (kind && kind !== "place_spawn") return null;
          const spawnId = strOrNull(a?.spawnId ?? a?.spawn_id);
          const type = strOrNull(a?.type);
          const archetype = strOrNull(a?.archetype) ?? "brain";
          const protoId = strOrNull(a?.protoId ?? a?.proto_id);
          const variantId = strOrNull(a?.variantId ?? a?.variant_id);
          const x = Number(a?.x);
          const y = Number(a?.y ?? 0);
          const z = Number(a?.z);
          const regionId = strOrNull(a?.regionId ?? a?.region_id);
          if (!spawnId || !type || !Number.isFinite(x) || !Number.isFinite(z)) return null;
          return { spawnId, type, archetype, protoId, variantId, x, y: Number.isFinite(y) ? y : 0, z, regionId };
        })
        .filter(Boolean);

      for (const row of placeRows) {
        wouldInsert += 1;
        const exists = await client.query(
          `SELECT id FROM spawn_points WHERE shard_id = $1 AND spawn_id = $2 LIMIT 1`,
          [shardId, (row as any).spawnId],
        );
        if ((exists.rows ?? []).length > 0) {
          // Keep it idempotent.
          continue;
        }

        await client.query(
          `
          INSERT INTO spawn_points (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            shardId,
            (row as any).spawnId,
            (row as any).type,
            (row as any).archetype,
            (row as any).protoId,
            (row as any).variantId,
            (row as any).x,
            (row as any).y,
            (row as any).z,
            (row as any).regionId,
          ],
        );
        inserted += 1;
      }

      if (commit) {
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }

      if (commit) {
        clearSpawnPointCache();
      }

      const payload: MotherBrainWaveResponse = commit
        ? {
            ok: true,
            shardId,
            bounds,
            cellSize: Number.isFinite(cellSize) ? cellSize : 64,
            theme,
            epoch,
            commit,
            append,
            inserted,
            deleted: wouldDelete,
          }
        : {
            ok: true,
            shardId,
            bounds,
            cellSize: Number.isFinite(cellSize) ? cellSize : 64,
            theme,
            epoch,
            commit,
            append,
            wouldInsert,
            wouldDelete,
          };

      res.json(payload);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[ADMIN/SPAWN_POINTS] mother_brain/wave error", err);
    res.status(500).json({
      ok: false,
      shardId,
      bounds,
      cellSize: Number.isFinite(cellSize) ? cellSize : 64,
      theme,
      epoch,
      commit,
      append,
      error: "internal_error",
    } satisfies MotherBrainWaveResponse);
  }
});

export default router;
