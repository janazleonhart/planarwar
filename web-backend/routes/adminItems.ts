// web-backend/routes/adminItems.ts
//
// Admin Items API
// - Canonical item id is items.id (text)
// - items.flags and items.stats are JSON/JSONB columns (NOT flags_json/stats_json)
// - Supports:
//    * GET /api/admin/items?q&limit&offset   (paged + search)
//    * GET /api/admin/items/options?q&limit  (typeahead for ItemPicker)
//    * POST /api/admin/items                (upsert)

import { Router } from "express";
import { db } from "../../worldcore/db/Database";

export const adminItemsRouter = Router();

type AdminItemPayload = {
  id: string;
  item_key?: string | null;
  name?: string | null;
  description?: string | null;
  rarity?: string | null;
  category?: string | null;
  specialization_id?: string | null;
  icon_id?: string | null;
  max_stack?: number | null;

  // JSON as text from UI (preferred inputs from AdminItemsPage)
  flagsText?: string | null;
  statsText?: string | null;

  // Optional alternate payload spellings (defensive)
  itemKey?: string | null;
  specializationId?: string | null;
  iconId?: string | null;
  maxStack?: number | null;
};

type ItemRow = {
  id: string;
  item_key: string | null;
  name: string | null;
  description: string | null;
  rarity: string | null;
  category: string | null;
  specialization_id: string | null;
  icon_id: string | null;
  max_stack: number | null;
  flags: any | null;
  stats: any | null;
};

function s(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function parseJsonTextMaybe(text: any): any | null {
  const t = s(text).trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    // Let caller surface a 400 with a friendly message.
    throw new Error("invalid_json");
  }
}

// GET /api/admin/items  -> list (paged + search)
// Response shape is intentionally richer than the old v0:
// { ok, total, limit, offset, items: [{..., flagsText, statsText}] }
adminItemsRouter.get("/", async (req, res) => {
  try {
    const qRaw = s(req.query.q).trim();
    const q = qRaw ? `%${qRaw}%` : "";
    const limit = clampInt(Number(req.query.limit ?? 200), 1, 2000);
    const offset = clampInt(Number(req.query.offset ?? 0), 0, 5_000_000);

    const whereSql = q
      ? "WHERE id ILIKE $1 OR name ILIKE $1 OR item_key ILIKE $1 OR category ILIKE $1"
      : "";
    const whereParams = q ? [q] : [];

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM items
       ${whereSql}`,
      whereParams
    );
    const total = Number(countRes.rows?.[0]?.count ?? 0);

    const dataParams = [...whereParams, limit, offset];
    const dataRes = await db.query(
      `
      SELECT
        id,
        item_key,
        name,
        description,
        rarity,
        category,
        specialization_id,
        icon_id,
        max_stack,
        COALESCE(flags, '{}'::jsonb) AS flags,
        COALESCE(stats, '{}'::jsonb) AS stats
      FROM items
      ${whereSql}
      ORDER BY id ASC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
      `,
      dataParams
    );

    const items = (dataRes.rows ?? []).map((row: ItemRow) => ({
      id: s((row as any).id),
      item_key: (row as any).item_key === null || (row as any).item_key === undefined ? null : s((row as any).item_key),
      name: (row as any).name === null || (row as any).name === undefined ? null : s((row as any).name),
      description:
        (row as any).description === null || (row as any).description === undefined ? null : s((row as any).description),
      rarity: (row as any).rarity === null || (row as any).rarity === undefined ? null : s((row as any).rarity),
      category: (row as any).category === null || (row as any).category === undefined ? null : s((row as any).category),
      specialization_id:
        (row as any).specialization_id === null || (row as any).specialization_id === undefined
          ? ""
          : s((row as any).specialization_id),
      icon_id:
        (row as any).icon_id === null || (row as any).icon_id === undefined ? "" : s((row as any).icon_id),
      max_stack: (row as any).max_stack === null || (row as any).max_stack === undefined ? null : Number((row as any).max_stack),
      flagsText:
        (row as any).flags && Object.keys((row as any).flags).length > 0 ? JSON.stringify((row as any).flags, null, 2) : "",
      statsText:
        (row as any).stats && Object.keys((row as any).stats).length > 0 ? JSON.stringify((row as any).stats, null, 2) : "",
    }));

    res.json({ ok: true, total, limit, offset, items });
  } catch (err: any) {
    const msg = err?.message === "invalid_json" ? "invalid_json" : (err?.message ?? String(err));
    res.status(500).json({ ok: false, error: msg });
  }
});

// GET /api/admin/items/options  -> lightweight options for ItemPicker (typeahead)
adminItemsRouter.get("/options", async (req, res) => {
  try {
    const qRaw = s(req.query.q).trim();
    const q = qRaw ? `%${qRaw}%` : "%";
    const limit = clampInt(Number(req.query.limit ?? 25), 1, 100);

    const r = await db.query(
      `
      SELECT id, name, rarity, icon_id
      FROM items
      WHERE id ILIKE $1 OR name ILIKE $1
      ORDER BY
        CASE WHEN id ILIKE $2 THEN 0 ELSE 1 END,
        id ASC
      LIMIT $3
      `,
      [q, `${qRaw}%`, limit]
    );

    const items = (r.rows ?? []).map((row: any) => ({
      id: s(row.id),
      name: row.name === null || row.name === undefined ? null : s(row.name),
      rarity: row.rarity === null || row.rarity === undefined ? null : s(row.rarity),
      iconId: row.icon_id === null || row.icon_id === undefined ? null : s(row.icon_id),
      label: row.name ? `${row.name} (${row.id})` : s(row.id),
    }));

    res.json({ ok: true, items });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// POST /api/admin/items  -> upsert item
adminItemsRouter.post("/", async (req, res) => {
  try {
    const body = (req.body ?? {}) as AdminItemPayload;

    const id = s(body.id).trim();
    if (!id) return res.status(400).json({ ok: false, error: "id is required" });

    const itemKey = s(body.item_key ?? body.itemKey ?? id).trim() || id;
    const name = s(body.name).trim() || null;
    const description = s(body.description).trim() || "";
    const rarity = s(body.rarity).trim() || null;
    const category = s(body.category).trim() || null;

    const maxStackRaw = body.max_stack ?? body.maxStack ?? null;
    const maxStack = maxStackRaw === null || maxStackRaw === undefined ? null : Number(maxStackRaw);

    const specializationId = s(body.specialization_id ?? body.specializationId).trim() || null;
    const iconId = s(body.icon_id ?? body.iconId).trim() || null;

    let flags: any = {};
    let stats: any = {};

    // Admin UI prefers sending flagsText/statsText (JSON-as-textareas)
    if (body.flagsText !== undefined && body.flagsText !== null) {
      const parsed = parseJsonTextMaybe(body.flagsText);
      flags = parsed ?? {};
    }
    if (body.statsText !== undefined && body.statsText !== null) {
      const parsed = parseJsonTextMaybe(body.statsText);
      stats = parsed ?? {};
    }

    await db.query(
      `
      INSERT INTO items (
        id, item_key, name, description, rarity, category,
        specialization_id, icon_id, max_stack,
        flags, stats
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        item_key = EXCLUDED.item_key,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        rarity = EXCLUDED.rarity,
        category = EXCLUDED.category,
        specialization_id = EXCLUDED.specialization_id,
        icon_id = EXCLUDED.icon_id,
        max_stack = EXCLUDED.max_stack,
        flags = EXCLUDED.flags,
        stats = EXCLUDED.stats
      `,
      [id, itemKey, name, description, rarity, category, specializationId, iconId, maxStack, flags, stats]
    );

    res.json({ ok: true, id });
  } catch (err: any) {
    if (err?.message === "invalid_json") {
      return res.status(400).json({ ok: false, error: "flagsText/statsText must be valid JSON" });
    }
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

export default adminItemsRouter;
