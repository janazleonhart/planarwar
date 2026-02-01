// web-backend/routes/adminAbilities.ts
//
// Admin: Abilities catalog editor.
//
// Supports:
//   GET  /api/admin/abilities?q&limit&offset
//   POST /api/admin/abilities   (upsert)
//
// Notes:
// - Admin auth is enforced by mounting with maybeRequireAdmin in web-backend/index.ts.
// - This endpoint edits the DB abilities catalog (metadata). Ability mechanics remain code-defined
//   in worldcore/abilities/AbilityTypes.ts for now.

import express, { type Request, type Response } from "express";
import { Pool } from "pg";

export const adminAbilitiesRouter = express.Router();

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
    _pool = new Pool();
    return _pool;
  }

  throw new Error(
    "routes/adminAbilities: Postgres is not configured. Set PW_DATABASE_URL (or DATABASE_URL / POSTGRES_URL / PG_URL) or PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGPORT.",
  );
}

type AbilityRow = {
  id: string;
  name: string;
  description: string;
  kind: string;
  resource_type: string | null;
  resource_cost: number | null;
  cooldown_ms: number | null;
  is_enabled: boolean;
  is_debug: boolean;
  is_dev_only: boolean;
  grant_min_role: string;
  flags: any;
  tags: string;
  created_at?: string;
  updated_at?: string;
};

function clampInt(v: any, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanStr(v: any, def = ""): string {
  const s = String(v ?? "").trim();
  return s ? s : def;
}

function normalizeNullableStr(v: any): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function normalizeNullableInt(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeBool(v: any, def: boolean): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return def;
}

function isSafeId(id: string): boolean {
  // Keep flexible: allow snake_case and a few separators for future namespacing.
  return /^[a-z0-9][a-z0-9_\-:.]*$/i.test(id);
}

adminAbilitiesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const q = cleanStr((req.query as any).q, "");
    const limit = clampInt((req.query as any).limit, 50, 1, 200);
    const offset = clampInt((req.query as any).offset, 0, 0, 1000000);

    const db = getPool();

    const where: string[] = [];
    const args: any[] = [];

    if (q) {
      args.push(`%${q}%`);
      const p = `$${args.length}`;
      where.push(`(id ILIKE ${p} OR name ILIKE ${p} OR description ILIKE ${p} OR tags ILIKE ${p})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalSql = `SELECT COUNT(*)::int AS c FROM public.abilities ${whereSql};`;
    const listSql = `
      SELECT
        id, name, description, kind,
        resource_type, resource_cost, cooldown_ms,
        is_enabled, is_debug, is_dev_only, grant_min_role,
        flags, tags, created_at, updated_at
      FROM public.abilities
      ${whereSql}
      ORDER BY id ASC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const totalRes = await db.query(totalSql, args);
    const total = Number(totalRes.rows?.[0]?.c ?? 0);

    const listRes = await db.query(listSql, args);

    return res.json({ ok: true, total, items: listRes.rows as AbilityRow[] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: "admin_abilities_list_failed", details: String(err?.message ?? err) });
  }
});

adminAbilitiesRouter.post("/", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<AbilityRow>;

    const id = cleanStr((body as any).id, "");
    if (!id || !isSafeId(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const row: AbilityRow = {
      id,
      name: cleanStr((body as any).name, id),
      description: cleanStr((body as any).description, ""),
      kind: cleanStr((body as any).kind, ""),
      resource_type: normalizeNullableStr((body as any).resource_type),
      resource_cost: normalizeNullableInt((body as any).resource_cost),
      cooldown_ms: normalizeNullableInt((body as any).cooldown_ms),
      is_enabled: normalizeBool((body as any).is_enabled, true),
      is_debug: normalizeBool((body as any).is_debug, false),
      is_dev_only: normalizeBool((body as any).is_dev_only, false),
      grant_min_role: cleanStr((body as any).grant_min_role, "player"),
      flags: (body as any).flags && typeof (body as any).flags === "object" ? (body as any).flags : {},
      tags: cleanStr((body as any).tags, ""),
    };

    const db = getPool();

    const sql = `
      INSERT INTO public.abilities
        (id, name, description, kind,
         resource_type, resource_cost, cooldown_ms,
         is_enabled, is_debug, is_dev_only, grant_min_role,
         flags, tags, updated_at)
      VALUES
        ($1,$2,$3,$4,
         $5,$6,$7,
         $8,$9,$10,$11,
         $12,$13, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        kind = EXCLUDED.kind,
        resource_type = EXCLUDED.resource_type,
        resource_cost = EXCLUDED.resource_cost,
        cooldown_ms = EXCLUDED.cooldown_ms,
        is_enabled = EXCLUDED.is_enabled,
        is_debug = EXCLUDED.is_debug,
        is_dev_only = EXCLUDED.is_dev_only,
        grant_min_role = EXCLUDED.grant_min_role,
        flags = EXCLUDED.flags,
        tags = EXCLUDED.tags,
        updated_at = now()
      RETURNING
        id, name, description, kind,
        resource_type, resource_cost, cooldown_ms,
        is_enabled, is_debug, is_dev_only, grant_min_role,
        flags, tags, created_at, updated_at;
    `;

    const r = await db.query(sql, [
      row.id,
      row.name,
      row.description,
      row.kind,
      row.resource_type,
      row.resource_cost,
      row.cooldown_ms,
      row.is_enabled,
      row.is_debug,
      row.is_dev_only,
      row.grant_min_role,
      row.flags,
      row.tags,
    ]);

    return res.json({ ok: true, item: r.rows?.[0] as AbilityRow });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: "admin_abilities_upsert_failed", details: String(err?.message ?? err) });
  }
});
