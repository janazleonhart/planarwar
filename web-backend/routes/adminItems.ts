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

// GET /api/admin/items  -> list items

// /admin/items/options -> lightweight item options for admin UIs (autocomplete, labels)
router.get("/options", async (req, res) => {
  try {
    const q = String((req.query.q ?? "") as any).trim();
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

    const args: any[] = [];
    let where = "";
    if (q) {
      args.push(`%${q}%`);
      where = "WHERE id ILIKE $1 OR name ILIKE $1";
    }

    const sql = `
      SELECT id, name, rarity, icon_id
      FROM items
      ${where}
      ORDER BY id
      LIMIT ${limit}
    `;

    const r = await db.query(sql, args);
    res.json({
      ok: true,
      items: r.rows.map((row: any) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        rarity: String(row.rarity ?? ""),
        iconId: row.icon_id ? String(row.icon_id) : null,
        label: row.name ? `${row.name} (${row.id})` : String(row.id),
      })),
    });
  } catch (err) {
    console.error("[ADMIN/ITEMS] options error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.get("/", async (_req, res) => {
  try {
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
      ORDER BY id
      LIMIT 500
      `
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
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: "flags must be valid JSON",
    });
  }

  try {
    if (body.statsText && body.statsText.trim().length > 0) {
      stats = JSON.parse(body.statsText);
    }
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: "stats must be valid JSON",
    });
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
      [
        id,
        itemKey,
        name,
        description,
        rarity,
        category,
        specId,
        iconId,
        maxStack,
        flags,
        stats,
      ]
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
