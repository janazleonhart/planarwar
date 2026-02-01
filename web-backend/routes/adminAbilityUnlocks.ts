// web-backend/routes/adminAbilityUnlocks.ts
//
// Admin: Ability unlock rules editor.
//
// Supports:
//   GET  /api/admin/ability_unlocks?classId&abilityId&q&limit&offset
//   POST /api/admin/ability_unlocks   (upsert)
//
// Notes:
// - Admin auth is enforced by mounting with maybeRequireAdmin in web-backend/index.ts.

import express, { type Request, type Response } from "express";
import { Pool } from "pg";

export const adminAbilityUnlocksRouter = express.Router();

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
    "routes/adminAbilityUnlocks: Postgres is not configured. Set PW_DATABASE_URL (or DATABASE_URL / POSTGRES_URL / PG_URL) or PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGPORT.",
  );
}

type UnlockRow = {
  class_id: string;
  ability_id: string;
  min_level: number;
  auto_grant: boolean;
  is_enabled: boolean;
  notes: string;
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

function normalizeBool(v: any, def: boolean): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return def;
}

function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_\-:.]*$/i.test(id);
}

adminAbilityUnlocksRouter.get("/", async (req: Request, res: Response) => {
  try {
    const q = cleanStr((req.query as any).q, "");
    const classId = cleanStr((req.query as any).classId, "");
    const abilityId = cleanStr((req.query as any).abilityId, "");
    const limit = clampInt((req.query as any).limit, 50, 1, 200);
    const offset = clampInt((req.query as any).offset, 0, 0, 1000000);

    const db = getPool();

    const where: string[] = [];
    const args: any[] = [];

    if (classId) {
      args.push(classId);
      where.push(`class_id = $${args.length}`);
    }
    if (abilityId) {
      args.push(abilityId);
      where.push(`ability_id = $${args.length}`);
    }
    if (q) {
      args.push(`%${q}%`);
      const p = `$${args.length}`;
      where.push(`(class_id ILIKE ${p} OR ability_id ILIKE ${p} OR notes ILIKE ${p})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalSql = `SELECT COUNT(*)::int AS c FROM public.ability_unlocks ${whereSql};`;
    const listSql = `
      SELECT
        class_id, ability_id, min_level, auto_grant, is_enabled, notes, created_at, updated_at
      FROM public.ability_unlocks
      ${whereSql}
      ORDER BY class_id ASC, min_level ASC, ability_id ASC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const totalRes = await db.query(totalSql, args);
    const total = Number(totalRes.rows?.[0]?.c ?? 0);

    const listRes = await db.query(listSql, args);

    return res.json({ ok: true, total, items: listRes.rows as UnlockRow[] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: "admin_ability_unlocks_list_failed", details: String(err?.message ?? err) });
  }
});

adminAbilityUnlocksRouter.post("/", express.json({ limit: "2mb" }), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<UnlockRow>;

    const class_id = cleanStr((body as any).class_id, "");
    const ability_id = cleanStr((body as any).ability_id, "");

    if (!class_id || !isSafeId(class_id)) return res.status(400).json({ ok: false, error: "invalid_class_id" });
    if (!ability_id || !isSafeId(ability_id)) return res.status(400).json({ ok: false, error: "invalid_ability_id" });

    const row: UnlockRow = {
      class_id,
      ability_id,
      min_level: clampInt((body as any).min_level, 1, 1, 1000),
      auto_grant: normalizeBool((body as any).auto_grant, true),
      is_enabled: normalizeBool((body as any).is_enabled, true),
      notes: cleanStr((body as any).notes, ""),
    };

    const db = getPool();

    const sql = `
      INSERT INTO public.ability_unlocks
        (class_id, ability_id, min_level, auto_grant, is_enabled, notes, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6, now())
      ON CONFLICT (class_id, ability_id) DO UPDATE SET
        min_level = EXCLUDED.min_level,
        auto_grant = EXCLUDED.auto_grant,
        is_enabled = EXCLUDED.is_enabled,
        notes = EXCLUDED.notes,
        updated_at = now()
      RETURNING
        class_id, ability_id, min_level, auto_grant, is_enabled, notes, created_at, updated_at;
    `;

    const r = await db.query(sql, [row.class_id, row.ability_id, row.min_level, row.auto_grant, row.is_enabled, row.notes]);

    return res.json({ ok: true, item: r.rows?.[0] as UnlockRow });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: "admin_ability_unlocks_upsert_failed", details: String(err?.message ?? err) });
  }
});
