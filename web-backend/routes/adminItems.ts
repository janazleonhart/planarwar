// web-backend/routes/adminItems.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";

const router = Router();

type AdminItemPayload = {
  id: string;
  item_key: string;
  name: string;
  description: string;
  rarity: string;
  category: string;
  specialization_id?: string | null;
  icon_id?: string | null;
  max_stack: number;
  flagsText?: string; // JSON as text from UI
  statsText?: string; // JSON as text from UI
};

type ItemRow = {
  id: string;
  item_key: string;
  name: string;
  description: string;
  rarity: string;
  category: string;
  specialization_id: string | null;
  icon_id: string | null;
  max_stack: number;
  flags: any;
  stats: any;
};

type ItemOptionRow = {
  id: string;
  name: string;
  rarity: string | null;
  icon_id: string | null;
};

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

// GET /api/admin/items/options?q=...&limit=...
// Lightweight autocomplete feed for item pickers.
router.get("/options", async (req, res) => {
  try {
    const qRaw = String(req.query.q ?? "").trim();
    const q = qRaw.length ? `%${qRaw}%` : "";
    const limit = clampInt(req.query.limit, 250, 1, 500);

    const result = (await db.query(
      `
      SELECT id, name, rarity, icon_id
      FROM items
      WHERE ($1 = '' OR id ILIKE $1 OR name ILIKE $1 OR item_key ILIKE $1)
      ORDER BY id
      LIMIT $2
      `,
      [q, limit]
    )) as { rows: ItemOptionRow[] };

    const items = result.rows.map((r) => {
      const name = String(r.name ?? "");
      const id = String(r.id);
      const rarity = r.rarity ?? "";
      const iconId = r.icon_id ?? "";
      const label = name ? `${name} (${id})` : id;
      return { id, name, rarity, iconId, label };
    });

    res.json({ ok: true, items });
  } catch (err) {
    console.error("[ADMIN/ITEMS] options error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// GET /api/admin/items?q=...&limit=...&offset=...
router.get("/", async (req, res) => {
  try {
    const qRaw = String(req.query.q ?? "").trim();
    const q = qRaw.length ? `%${qRaw}%` : "";
    const limit = clampInt(req.query.limit, 500, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 500_000);

    const result = (await db.query(
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
        flags,
        stats
      FROM items
      WHERE ($1 = '' OR id ILIKE $1 OR name ILIKE $1 OR item_key ILIKE $1 OR category ILIKE $1)
      ORDER BY id
      LIMIT $2
      OFFSET $3
      `,
      [q, limit, offset]
    )) as { rows: ItemRow[] };

    const items = result.rows.map((row: ItemRow) => ({
      id: row.id,
      item_key: row.item_key,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      category: row.category,
      specialization_id: row.specialization_id ?? "",
      icon_id: row.icon_id ?? "",
      max_stack: row.max_stack,
      flagsText:
        row.flags && Object.keys(row.flags).length > 0
          ? JSON.stringify(row.flags, null, 2)
          : "",
      statsText:
        row.stats && Object.keys(row.stats).length > 0
          ? JSON.stringify(row.stats, null, 2)
          : "",
    }));

    res.json({ ok: true, items });
  } catch (err) {
    console.error("[ADMIN/ITEMS] list error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /api/admin/items  -> upsert item
router.post("/", async (req, res) => {
  const body = req.body as AdminItemPayload;

  if (!body.id || !body.name) {
    return res.status(400).json({
      ok: false,
      error: "id and name are required",
    });
  }

  const id = body.id.trim();
  const itemKey = (body.item_key || id).trim();
  const name = body.name.trim();
  const description = body.description || "";
  const rarity = body.rarity || "common";
  const category = body.category || "misc";
  const specId = body.specialization_id?.trim() || null;
  const iconId = body.icon_id?.trim() || null;
  const maxStack = Number(body.max_stack || 1) || 1;

  // Parse JSON fields
  let flags: any = {};
  let stats: any = {};

  try {
    if (body.flagsText && body.flagsText.trim().length > 0) {
      flags = JSON.parse(body.flagsText);
    }
  } catch {
    return res.status(400).json({ ok: false, error: "flags must be valid JSON" });
  }

  try {
    if (body.statsText && body.statsText.trim().length > 0) {
      stats = JSON.parse(body.statsText);
    }
  } catch {
    return res.status(400).json({ ok: false, error: "stats must be valid JSON" });
  }

  try {
    await db.query(
      `
      INSERT INTO items (
        id,
        item_key,
        name,
        description,
        rarity,
        category,
        specialization_id,
        icon_id,
        max_stack,
        flags,
        stats
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )
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
      [id, itemKey, name, description, rarity, category, specId, iconId, maxStack, flags, stats]
    );

    // For v0 we won't hot-reload MMO items here.
    // You can restart the MMO to pick up changes.

    res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN/ITEMS] upsert error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
