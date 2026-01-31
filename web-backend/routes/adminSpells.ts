// web-backend/routes/adminSpells.ts

import { Router } from "express";

import { db } from "worldcore/db/Database";

type AdminSpellRow = {
  id: string;
  name: string;
  description: string;
  kind: string;
  class_id: string | null;
  min_level: number;
  school: string;
  is_song: boolean;
  song_school: string | null;
  resource_type: string;
  resource_cost: number;
  cooldown_ms: number;
  damage_multiplier: number;
  flat_bonus: number;
  heal_amount: number;
  flags: any;
  tags: string[];
  status_effect: any;
  cleanse: any;
  is_debug: boolean;
  is_dev_only: boolean;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

type AdminSpellListResponse = {
  spells: AdminSpellRow[];
  limit: number;
  offset: number;
  q: string;
};

function parseJsonOrNull(input: unknown, fieldName: string): any {
  if (input === null || input === undefined) return null;
  if (typeof input === "object") return input;
  if (typeof input !== "string") {
    throw new Error(`${fieldName}: must be JSON object or JSON string`);
  }

  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${fieldName}: invalid JSON`);
  }
}

function parseTags(input: unknown): string[] {
  if (input === null || input === undefined) return [];
  if (Array.isArray(input)) return input.map(String).filter(Boolean);
  if (typeof input !== "string") return [];
  return input
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

const router = Router();

// GET /api/admin/spells?q=...
router.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.max(1, Math.min(250, Number(req.query.limit ?? 100)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  const qParam = q.length ? q : null;

  const { rows } = await db.query<AdminSpellRow>(
    `
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
        resource_type,
        resource_cost,
        cooldown_ms,
        damage_multiplier,
        flat_bonus,
        heal_amount,
        flags,
        tags,
        status_effect,
        cleanse,
        is_debug,
        is_dev_only,
        is_enabled,
        created_at,
        updated_at
      FROM spells
      WHERE (
        $1::text IS NULL
        OR id ILIKE '%' || $1 || '%'
        OR name ILIKE '%' || $1 || '%'
      )
      ORDER BY name ASC
      LIMIT $2 OFFSET $3
    `,
    [qParam, limit, offset]
  );

  const body: AdminSpellListResponse = {
    spells: rows,
    limit,
    offset,
    q,
  };
  res.json(body);
});

// POST /api/admin/spells
router.post("/", async (req, res) => {
  try {
    const b = req.body ?? {};

    const id = String(b.id ?? "").trim();
    const name = String(b.name ?? "").trim();

    if (!id) return res.status(400).json({ error: "id is required" });
    if (!name) return res.status(400).json({ error: "name is required" });

    const description = String(b.description ?? "");
    const kind = String(b.kind ?? "spell");
    const classId = b.class_id === null || b.class_id === undefined || String(b.class_id).trim() === "" ? null : String(b.class_id);
    const minLevel = Math.max(0, Number(b.min_level ?? 1));
    const school = String(b.school ?? "arcane");
    const isSong = Boolean(b.is_song ?? false);
    const songSchool = b.song_school === null || b.song_school === undefined || String(b.song_school).trim() === "" ? null : String(b.song_school);
    const resourceType = String(b.resource_type ?? "mana");
    const resourceCost = Math.max(0, Number(b.resource_cost ?? 0));
    const cooldownMs = Math.max(0, Number(b.cooldown_ms ?? 0));
    const damageMultiplier = Number(b.damage_multiplier ?? 1);
    const flatBonus = Number(b.flat_bonus ?? 0);
    const healAmount = Number(b.heal_amount ?? 0);

    const flags = parseJsonOrNull(b.flags, "flags");
    const statusEffect = parseJsonOrNull(b.status_effect, "status_effect");
    const cleanse = parseJsonOrNull(b.cleanse, "cleanse");
    const tags = parseTags(b.tags);

    const isDebug = Boolean(b.is_debug ?? false);
    const isDevOnly = Boolean(b.is_dev_only ?? false);
    const isEnabled = Boolean(b.is_enabled ?? true);

    const { rows } = await db.query<AdminSpellRow>(
      `
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
          resource_type,
          resource_cost,
          cooldown_ms,
          damage_multiplier,
          flat_bonus,
          heal_amount,
          flags,
          tags,
          status_effect,
          cleanse,
          is_debug,
          is_dev_only,
          is_enabled
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
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
          resource_type = EXCLUDED.resource_type,
          resource_cost = EXCLUDED.resource_cost,
          cooldown_ms = EXCLUDED.cooldown_ms,
          damage_multiplier = EXCLUDED.damage_multiplier,
          flat_bonus = EXCLUDED.flat_bonus,
          heal_amount = EXCLUDED.heal_amount,
          flags = EXCLUDED.flags,
          tags = EXCLUDED.tags,
          status_effect = EXCLUDED.status_effect,
          cleanse = EXCLUDED.cleanse,
          is_debug = EXCLUDED.is_debug,
          is_dev_only = EXCLUDED.is_dev_only,
          is_enabled = EXCLUDED.is_enabled,
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
          resource_type,
          resource_cost,
          cooldown_ms,
          damage_multiplier,
          flat_bonus,
          heal_amount,
          flags,
          tags,
          status_effect,
          cleanse,
          is_debug,
          is_dev_only,
          is_enabled,
          created_at,
          updated_at
      `,
      [
        id,
        name,
        description,
        kind,
        classId,
        minLevel,
        school,
        isSong,
        songSchool,
        resourceType,
        resourceCost,
        cooldownMs,
        damageMultiplier,
        flatBonus,
        healAmount,
        flags,
        tags,
        statusEffect,
        cleanse,
        isDebug,
        isDevOnly,
        isEnabled,
      ]
    );

    res.json({ ok: true, spell: rows[0] });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "unknown error" });
  }
});

export const adminSpellsRouter = router;
export default adminSpellsRouter;
