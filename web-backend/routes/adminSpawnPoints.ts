// web-backend/routes/adminSpawnPoints.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";
import { clearSpawnPointCache } from "../../worldcore/world/SpawnPointCache";
import { getSpawnAuthority, isSpawnEditable } from "../../worldcore/world/spawnAuthority";

const router = Router();

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
  authority?: "anchor" | "seed" | "brain" | "manual";
};

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
  const s = String(v ?? "").trim();
  return s;
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
  if ((t === "npc" || t === "mob" || t === "creature" || t === "node" || t === "resource") && !protoId) {
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

// GET /api/admin/spawn_points?shardId=prime_shard&regionId=prime_shard:0,0
// GET /api/admin/spawn_points?shardId=prime_shard&x=0&z=0&radius=500
router.get("/", async (req, res) => {
  try {
    const shardId = String(req.query.shardId ?? "prime_shard").trim();
    const regionId = strOrNull(req.query.regionId);
    const x = numOrNull(req.query.x);
    const z = numOrNull(req.query.z);
    const radius = numOrNull(req.query.radius);

    let rows: any[] = [];

    if (regionId) {
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
          town_tier
        FROM spawn_points
        WHERE shard_id = $1 AND region_id = $2
        ORDER BY id ASC
        `,
        [shardId, regionId],
      );
      rows = r.rows ?? [];
    } else if (x !== null && z !== null && radius !== null) {
      const safeRadius = Math.max(0, Math.min(radius, 10_000));
      const r2 = safeRadius * safeRadius;

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
          town_tier
        FROM spawn_points
        WHERE
          shard_id = $1
          AND x IS NOT NULL
          AND z IS NOT NULL
          AND ((x - $2) * (x - $2) + (z - $3) * (z - $3)) <= $4
        ORDER BY id ASC
        `,
        [shardId, x, z, r2],
      );
      rows = r.rows ?? [];
    } else {
      // conservative default: return a small window rather than dumping the world
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
          town_tier
        FROM spawn_points
        WHERE shard_id = $1
        ORDER BY id DESC
        LIMIT 200
        `,
        [shardId],
      );
      rows = r.rows ?? [];
    }

    const points: AdminSpawnPoint[] = rows.map((r: any) => {
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
    });

    res.json({ ok: true, spawnPoints: points });
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

export default router;
