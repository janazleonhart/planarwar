// web-backend/routes/spells.ts
import express from "express";
import { Pool } from "pg";

const router = express.Router();

// Minimal local pool (web-backend already uses Postgres in other routes via worldcore services).
let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;

  // Prefer a single connection string if present.
  const connectionString =
    process.env.PW_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.PG_URL ??
    process.env.PW_PG_URL;

  if (connectionString) {
    _pool = new Pool({ connectionString });
    return _pool;
  }

  // Fall back to discrete PG* vars (pg reads from process.env).
  const hasDiscrete =
    !!process.env.PGHOST ||
    !!process.env.PGUSER ||
    !!process.env.PGDATABASE ||
    !!process.env.PGPASSWORD ||
    !!process.env.PGPORT;

  if (hasDiscrete) {
    _pool = new Pool();
    return _pool;
  }

  throw new Error(
    "routes/spells: Postgres is not configured. Set PW_DATABASE_URL (or DATABASE_URL / POSTGRES_URL / PG_URL).",
  );
}

type SpellRow = {
  id: string;
  name: string;
  class_id: string;
  min_level: number;
  is_song: boolean;
  is_enabled: boolean;
  grant_min_role: string;
  resource_cost: number;
  cooldown_ms: number;
  notes: string | null;
};

function splitCsv(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// GET /api/spells?ids=a,b,c
// GET /api/spells?q=bolt
router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const ids = splitCsv(typeof req.query.ids === "string" ? req.query.ids : "");
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    // Safety caps
    const MAX_IDS = 200;
    const LIMIT = 200;

    const safeIds = ids.slice(0, MAX_IDS);

    let sql = `
      SELECT
        id,
        name,
        class_id,
        min_level,
        is_song,
        is_enabled,
        grant_min_role,
        resource_cost,
        cooldown_ms,
        notes
      FROM public.spells
      WHERE is_enabled = true
    `;

    const params: any[] = [];
    let p = 1;

    if (safeIds.length > 0) {
      sql += ` AND id = ANY($${p}::text[])`;
      params.push(safeIds);
      p++;
    }

    if (q) {
      sql += ` AND (id ILIKE $${p} OR name ILIKE $${p})`;
      params.push(`%${q}%`);
      p++;
    }

    sql += ` ORDER BY class_id ASC, min_level ASC, id ASC LIMIT ${LIMIT}`;

    const r = await pool.query<SpellRow>(sql, params);

    const spells = r.rows.map((s) => ({
      id: s.id,
      name: s.name,
      classId: s.class_id,
      minLevel: s.min_level,
      isSong: s.is_song,
      grantMinRole: s.grant_min_role,
      resourceCost: s.resource_cost,
      cooldownMs: s.cooldown_ms,
      notes: s.notes ?? undefined,
    }));

    res.json({ ok: true, spells });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

export default router;
