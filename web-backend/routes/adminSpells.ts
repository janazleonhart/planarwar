// web-backend/routes/adminSpells.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";

export const adminSpellsRouter = Router();

// -------------------------
// Types
// -------------------------

export interface AdminSpellRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  class_id: string;
  min_level: number;
  school: string | null;

  is_song: boolean;
  song_school: string | null;

  resource: string | null;
  cost: number;
  cooldown_ms: number;

  damage_mult: number;
  flat_bonus: number;
  heal_amount: number;

  tags: string[] | null;
  flags: any | null;
  status_effect: any | null;
  cleanse: any | null;

  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminSpellUpsertInput {
  id: string;
  name: string;
  description?: string | null;
  kind: string;
  class_id: string;
  min_level: number;
  school?: string | null;

  is_song?: boolean;
  song_school?: string | null;

  resource?: string | null;
  cost?: number;
  cooldown_ms?: number;

  damage_mult?: number;
  flat_bonus?: number;
  heal_amount?: number;

  tags?: string[];
  flags?: any;
  status_effect?: any;
  cleanse?: any;

  enabled?: boolean;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function toNullableString(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
}

function parseJsonOrNull(v: unknown): any | null {
  if (v === null || v === undefined) return null;
  // Already an object/array? Keep it.
  if (typeof v === "object") return v;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// -------------------------------------------
// GET /api/admin/spells?q&limit&offset
// -------------------------------------------
adminSpellsRouter.get("/", async (req, res) => {
  try {
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const limit = clampInt(
      typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50,
      1,
      500
    );
    const offset = clampInt(
      typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0,
      0,
      1_000_000
    );

    const hasQ = qRaw.length > 0;
    const qLike = `%${qRaw}%`;

    const totalSql = hasQ
      ? `
        SELECT COUNT(*)::int AS total
        FROM spells
        WHERE (id ILIKE $1 OR name ILIKE $1)
      `
      : `
        SELECT COUNT(*)::int AS total
        FROM spells
      `;

    const totalParams = hasQ ? [qLike] : [];
    const totalRes = await db.query<{ total: number }>(totalSql, totalParams);
    const total = totalRes.rows[0]?.total ?? 0;

    // When hasQ=false, limit/offset are $1/$2; when hasQ=true, limit/offset are $2/$3
    const limitParam = hasQ ? 2 : 1;
    const offsetParam = hasQ ? 3 : 2;

    const listSql = `
      SELECT
        id,
        name,
        description,
        kind,
        class_id,
        min_level,
        school,
        is_song,
        song_school,
        resource,
        cost,
        cooldown_ms,
        damage_mult,
        flat_bonus,
        heal_amount,
        tags,
        flags,
        status_effect,
        cleanse,
        enabled,
        created_at,
        updated_at
      FROM spells
      ${hasQ ? "WHERE (id ILIKE $1 OR name ILIKE $1)" : ""}
      ORDER BY id ASC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `;

    const listParams = hasQ ? [qLike, limit, offset] : [limit, offset];
    const listRes = await db.query<AdminSpellRow>(listSql, listParams);

    return res.json({
      ok: true,
      spells: listRes.rows,
      total,
      limit,
      offset,
      q: qRaw || null,
    });
  } catch (err) {
    console.error("[adminSpellsRouter.get /] error", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/admin/spells/:id
 */
adminSpellsRouter.get("/:id", async (req, res) => {
  try {
    const id = (req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

    const sql = `
      SELECT
        id,
        name,
        description,
        kind,
        class_id,
        min_level,
        school,
        is_song,
        song_school,
        resource,
        cost,
        cooldown_ms,
        damage_mult,
        flat_bonus,
        heal_amount,
        tags,
        flags,
        status_effect,
        cleanse,
        enabled,
        created_at,
        updated_at
      FROM spells
      WHERE id = $1
      LIMIT 1
    `;

    const qres = await db.query<AdminSpellRow>(sql, [id]);
    const row = qres.rows[0];
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });

    return res.json({ ok: true, spell: row });
  } catch (err) {
    console.error("[adminSpellsRouter.get /:id] error", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/admin/spells
 * Body: AdminSpellUpsertInput
 */
adminSpellsRouter.post("/", async (req, res) => {
  try {
    const input = req.body as AdminSpellUpsertInput;

    const id = (input?.id || "").trim();
    const name = (input?.name || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
    if (!name) return res.status(400).json({ ok: false, error: "Missing name" });

    const description = toNullableString(input?.description);
    const kind = (input?.kind || "").trim();
    const class_id = (input?.class_id || "").trim();
    const min_level = clampInt(input?.min_level ?? 1, 1, 200);
    const school = toNullableString(input?.school);

    const is_song = !!input?.is_song;
    const song_school = toNullableString(input?.song_school);

    const resource = toNullableString(input?.resource);
    const cost = clampInt(input?.cost ?? 0, 0, 1_000_000);
    const cooldown_ms = clampInt(input?.cooldown_ms ?? 0, 0, 60 * 60 * 1000);

    const damage_mult = typeof input?.damage_mult === "number" ? input.damage_mult : 1;
    const flat_bonus = typeof input?.flat_bonus === "number" ? input.flat_bonus : 0;
    const heal_amount = typeof input?.heal_amount === "number" ? input.heal_amount : 0;

    const tags = Array.isArray(input?.tags)
      ? input.tags.filter((t) => typeof t === "string")
      : [];

    const flagsJson = parseJsonOrNull(input?.flags ?? null);
    const statusEffectJson = parseJsonOrNull(input?.status_effect ?? null);
    const cleanseJson = parseJsonOrNull(input?.cleanse ?? null);

    const enabled = input?.enabled !== undefined ? !!input.enabled : true;

    const sql = `
      INSERT INTO spells (
        id,
        name,
        description,
        kind,
        class_id,
        min_level,
        school,
        is_song,
        song_school,
        resource,
        cost,
        cooldown_ms,
        damage_mult,
        flat_bonus,
        heal_amount,
        tags,
        flags,
        status_effect,
        cleanse,
        enabled
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16::text[],
        $17::jsonb,
        $18::jsonb,
        $19::jsonb,
        $20
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        kind = EXCLUDED.kind,
        class_id = EXCLUDED.class_id,
        min_level = EXCLUDED.min_level,
        school = EXCLUDED.school,
        is_song = EXCLUDED.is_song,
        song_school = EXCLUDED.song_school,
        resource = EXCLUDED.resource,
        cost = EXCLUDED.cost,
        cooldown_ms = EXCLUDED.cooldown_ms,
        damage_mult = EXCLUDED.damage_mult,
        flat_bonus = EXCLUDED.flat_bonus,
        heal_amount = EXCLUDED.heal_amount,
        tags = EXCLUDED.tags,
        flags = EXCLUDED.flags,
        status_effect = EXCLUDED.status_effect,
        cleanse = EXCLUDED.cleanse,
        enabled = EXCLUDED.enabled,
        updated_at = NOW()
      RETURNING
        id,
        name,
        description,
        kind,
        class_id,
        min_level,
        school,
        is_song,
        song_school,
        resource,
        cost,
        cooldown_ms,
        damage_mult,
        flat_bonus,
        heal_amount,
        tags,
        flags,
        status_effect,
        cleanse,
        enabled,
        created_at,
        updated_at
    `;

    const params = [
      id,
      name,
      description,
      kind,
      class_id,
      min_level,
      school,
      is_song,
      song_school,
      resource,
      cost,
      cooldown_ms,
      damage_mult,
      flat_bonus,
      heal_amount,
      tags,
      flagsJson === null ? null : JSON.stringify(flagsJson),
      statusEffectJson === null ? null : JSON.stringify(statusEffectJson),
      cleanseJson === null ? null : JSON.stringify(cleanseJson),
      enabled,
    ];

    const qres = await db.query<AdminSpellRow>(sql, params);
    const row = qres.rows[0];
    if (!row) return res.status(500).json({ ok: false, error: "Upsert failed" });

    return res.json({ ok: true, spell: row });
  } catch (err) {
    console.error("[adminSpellsRouter.post /] error", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});
