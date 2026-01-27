// web-backend/routes/items.ts
import express from "express";
import { Pool } from "pg";

const router = express.Router();

// Minimal local pool (keeps web-backend decoupled from worldcore/db).
let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;

  const connectionString =
    process.env.PW_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PG_URL ||
    process.env.PW_PG_URL;

  if (!connectionString) {
    throw new Error(
      "DB connection string missing. Set PW_DATABASE_URL or DATABASE_URL (or PG_URL)."
    );
  }

  _pool = new Pool({ connectionString });
  return _pool;
}

let _itemsColsCache: Set<string> | null = null;

async function getItemsColumns(pool: Pool): Promise<Set<string>> {
  if (_itemsColsCache) return _itemsColsCache;
  const res = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'items'`
  );
  _itemsColsCache = new Set((res.rows ?? []).map((r: any) => String(r.column_name)));
  return _itemsColsCache;
}

function pickCols(existing: Set<string>, desired: string[]): string[] {
  return desired.filter((c) => existing.has(c));
}

// GET /api/items?ids=a,b,c
// - Returns a minimal metadata array for UI panels.
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const cols = await getItemsColumns(pool);

    const idsParam = String(req.query.ids ?? "").trim();
    const ids = idsParam
      ? idsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 500);

    // Choose best-effort column set (schema can evolve; we only select what exists)
    const desired = [
      "id",
      "name",
      "description",
      "kind",
      "category",
      "rarity",
      "stack_max",
      "slot",
      "equip_slot",
      "base_value",
      "requirements",
      "stats",
      "tags",
      "is_enabled",
      "is_dev_only",
      "grant_min_role",
      "created_at",
      "updated_at",
    ];
    const selectCols = pickCols(cols, desired);
    const selectSql = selectCols.length ? selectCols.map((c) => `"${c}"`).join(", ") : "*";

    let rows: any[] = [];

    if (ids.length > 0) {
      const sql = `SELECT ${selectSql} FROM public.items WHERE id = ANY($1::text[])`;
      const r = await pool.query(sql, [ids]);
      rows = r.rows ?? [];
    } else if (q) {
      // Simple name/id search (works even on early schema).
      const wantsName = cols.has("name");
      const where = wantsName
        ? "(id ILIKE $1 OR name ILIKE $1)"
        : "(id ILIKE $1)";
      const sql = `SELECT ${selectSql} FROM public.items WHERE ${where} ORDER BY id LIMIT $2`;
      const r = await pool.query(sql, [`%${q}%`, limit]);
      rows = r.rows ?? [];
    } else {
      // Default: return a small slice for debugging.
      const wantsName = cols.has("name");
      const order = wantsName ? "ORDER BY name" : "ORDER BY id";
      const sql = `SELECT ${selectSql} FROM public.items ${order} LIMIT $1`;
      const r = await pool.query(sql, [limit]);
      rows = r.rows ?? [];
    }

    res.json({ items: rows });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

export default router;
