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

function splitCsv(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

let _spellsColsCache: Set<string> | null = null;

async function getSpellsColumns(pool: Pool): Promise<Set<string>> {
  if (_spellsColsCache) return _spellsColsCache;
  const res = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'spells'`,
  );
  _spellsColsCache = new Set((res.rows ?? []).map((r: any) => String(r.column_name)));
  return _spellsColsCache;
}

function selectOrNull(existing: Set<string>, col: string, typeSql: string, alias?: string): string {
  const a = alias ?? col;
  if (existing.has(col)) return `"${col}"`;
  return `NULL::${typeSql} AS "${a}"`;
}

function selectOrDefault(existing: Set<string>, col: string, defaultExpr: string, alias?: string): string {
  const a = alias ?? col;
  if (existing.has(col)) return `"${col}"`;
  return `${defaultExpr} AS "${a}"`;
}

// GET /api/spells?ids=a,b,c
// GET /api/spells?q=bolt
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const cols = await getSpellsColumns(pool);

    const ids = splitCsv(typeof req.query.ids === "string" ? req.query.ids : "");
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    // Safety caps
    const MAX_IDS = 200;
    const LIMIT = 200;

    const safeIds = ids.slice(0, MAX_IDS);

    // Build a schema-flexible SELECT. Your current spells table (screenshot) is minimal and
    // does not include newer fields like notes/cooldown/resource_cost.
    const select = [
      '"id"',
      selectOrNull(cols, "name", "text"),
      selectOrNull(cols, "description", "text"),
      selectOrNull(cols, "kind", "text"),
      selectOrNull(cols, "class_id", "text"),
      selectOrNull(cols, "min_level", "integer"),
      selectOrNull(cols, "school", "text"),
      selectOrDefault(cols, "is_song", "false", "is_song"),
      selectOrNull(cols, "song_school", "text"),

      // Optional modern columns (defaulted if missing)
      selectOrDefault(cols, "is_enabled", "true", "is_enabled"),
      selectOrDefault(cols, "grant_min_role", "'player'::text", "grant_min_role"),
      selectOrNull(cols, "resource_cost", "integer", "resource_cost"),
      selectOrNull(cols, "cooldown_ms", "integer", "cooldown_ms"),
      selectOrNull(cols, "notes", "text", "notes"),
    ].join(", ");

    let sql = `SELECT ${select} FROM public.spells`;

    const where: string[] = [];
    const params: any[] = [];
    let p = 1;

    // Only filter is_enabled if the column exists; otherwise treat all rows as enabled.
    if (cols.has("is_enabled")) {
      where.push(`"is_enabled" = true`);
    }

    if (safeIds.length > 0) {
      where.push(`"id" = ANY($${p}::text[])`);
      params.push(safeIds);
      p++;
    }

    if (q) {
      // name might be NULL::text if missing, but id always exists.
      if (cols.has("name")) {
        where.push(`("id" ILIKE $${p} OR "name" ILIKE $${p})`);
      } else {
        where.push(`("id" ILIKE $${p})`);
      }
      params.push(`%${q}%`);
      p++;
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }

    // Order by what exists.
    const orderParts: string[] = [];
    if (cols.has("class_id")) orderParts.push(`"class_id" ASC`);
    if (cols.has("min_level")) orderParts.push(`"min_level" ASC`);
    orderParts.push(`"id" ASC`);

    sql += ` ORDER BY ${orderParts.join(", ")} LIMIT ${LIMIT}`;

    const r = await pool.query(sql, params);

    const spells = (r.rows ?? []).map((s: any) => ({
      id: String(s.id),
      name: s.name ?? String(s.id),
      description: s.description ?? undefined,
      kind: s.kind ?? undefined,
      classId: s.class_id ?? undefined,
      minLevel: typeof s.min_level === "number" ? s.min_level : undefined,
      school: s.school ?? undefined,
      isSong: typeof s.is_song === "boolean" ? s.is_song : !!s.is_song,
      songSchool: s.song_school ?? undefined,

      isEnabled: typeof s.is_enabled === "boolean" ? s.is_enabled : true,
      grantMinRole: s.grant_min_role ?? "player",
      resourceCost:
        typeof s.resource_cost === "number" ? s.resource_cost : s.resource_cost ? Number(s.resource_cost) : undefined,
      cooldownMs:
        typeof s.cooldown_ms === "number" ? s.cooldown_ms : s.cooldown_ms ? Number(s.cooldown_ms) : undefined,
      notes: s.notes ?? undefined,
    }));

    res.json({ ok: true, spells });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

export default router;
