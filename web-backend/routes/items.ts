// web-backend/routes/items.ts
//
// Items metadata endpoint used by the Web Console Player Panels.
//
// Supports:
//   GET /api/items?ids=a,b,c
//   GET /api/items?q=peace&limit=50
//
// Connection:
// - Prefers a single connection string (PW_DATABASE_URL / DATABASE_URL / POSTGRES_URL / PG_URL).
// - Falls back to discrete PG* env vars (PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGPORT) by letting `pg` read process.env.
//   This matches the pattern used by routes/spells.ts.
//

import express from "express";
import { Pool } from "pg";

const router = express.Router();

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;

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

  const hasDiscrete =
    !!process.env.PGHOST ||
    !!process.env.PGUSER ||
    !!process.env.PGDATABASE ||
    !!process.env.PGPASSWORD ||
    !!process.env.PGPORT;

  if (hasDiscrete) {
    // `pg` will read the discrete PG* vars automatically.
    _pool = new Pool();
    return _pool;
  }

  throw new Error(
    "routes/items: Postgres is not configured. Set PW_DATABASE_URL (or DATABASE_URL / POSTGRES_URL / PG_URL) or PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGPORT.",
  );
}

let _itemsColsCache: Set<string> | null = null;

async function getItemsColumns(pool: Pool): Promise<Set<string>> {
  if (_itemsColsCache) return _itemsColsCache;
  const res = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'items'`,
  );
  _itemsColsCache = new Set((res.rows ?? []).map((r: any) => String(r.column_name)));
  return _itemsColsCache;
}

function buildSelectSql(existing: Set<string>): string {
  const want = (c: string) => existing.has(c);
  const exprs: string[] = [];

  const push = (expr: string) => exprs.push(expr);

  // Core identity + display
  if (want("id")) push('"id"');
  if (want("item_key")) push('"item_key"');
  if (want("name")) push('"name"');
  if (want("description")) push('"description"');
  if (want("rarity")) push('"rarity"');
  if (want("category")) push('"category"');
  if (want("kind")) push('"kind"');

  // Extra fields seen in your DB screenshot / useful for UI
  if (want("specialization_id")) push('"specialization_id"');
  if (want("icon_id")) push('"icon_id"');
  if (want("flags")) push('"flags"');

  // Stack column can vary; normalize to stack_max in payload.
  if (want("stack_max")) push('"stack_max"');
  else if (want("max_stack")) push('"max_stack" AS "stack_max"');

  // Equip-ish / economy
  if (want("slot")) push('"slot"');
  if (want("equip_slot")) push('"equip_slot"');
  if (want("base_value")) push('"base_value"');

  // JSON-ish columns (UI should not blob-dump inline)
  if (want("requirements")) push('"requirements"');
  if (want("stats")) push('"stats"');
  if (want("tags")) push('"tags"');

  // Gating / misc
  if (want("is_enabled")) push('"is_enabled"');
  if (want("is_dev_only")) push('"is_dev_only"');
  if (want("grant_min_role")) push('"grant_min_role"');
  if (want("notes")) push('"notes"');
  if (want("created_at")) push('"created_at"');
  if (want("updated_at")) push('"updated_at"');

  return exprs.length ? exprs.join(", ") : "*";
}

function splitCsv(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// GET /api/items?ids=a,b,c
// GET /api/items?q=peace
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const cols = await getItemsColumns(pool);

    const ids = splitCsv(typeof req.query.ids === "string" ? req.query.ids : "");
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    // Safety caps
    const MAX_IDS = 200;
    const LIMIT = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 500);

    const safeIds = ids.slice(0, MAX_IDS);
    const selectSql = buildSelectSql(cols);

    let sql = `SELECT ${selectSql} FROM public.items WHERE 1=1`;
    const params: any[] = [];
    let p = 1;

    if (safeIds.length > 0) {
      sql += ` AND id = ANY($${p}::text[])`;
      params.push(safeIds);
      p++;
    }

    if (q) {
      const wantsName = cols.has("name");
      sql += wantsName ? ` AND (id ILIKE $${p} OR name ILIKE $${p})` : ` AND (id ILIKE $${p})`;
      params.push(`%${q}%`);
      p++;
    }

    // Default ordering
    if (cols.has("name")) sql += ` ORDER BY name ASC, id ASC`;
    else sql += ` ORDER BY id ASC`;

    sql += ` LIMIT ${LIMIT}`;

    const r = await pool.query(sql, params);
    return res.json({ ok: true, items: r.rows ?? [] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

export default router;
