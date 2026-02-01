// web-backend/routes/adminSpells.ts

import { Router } from "express";
import { db } from "../../worldcore/db/Database";

export const adminSpellsRouter = Router();

// -------------------------
// Helpers
// -------------------------

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

// -------------------------
// Schema drift protection
// -------------------------

let spellsColumnsCache: Set<string> | null = null;
let spellsColumnsLoading: Promise<Set<string>> | null = null;

async function getSpellsColumns(): Promise<Set<string>> {
  if (spellsColumnsCache) return spellsColumnsCache;
  if (spellsColumnsLoading) return spellsColumnsLoading;

  spellsColumnsLoading = (async () => {
    const sql = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'spells'
        AND table_schema = ANY (current_schemas(false))
    `;
    const r = await db.query<{ column_name: string }>(sql);
    const set = new Set<string>(r.rows.map((x) => (x.column_name || "").toLowerCase()));
    spellsColumnsCache = set;
    spellsColumnsLoading = null;
    return set;
  })();

  return spellsColumnsLoading;
}

async function hasCol(col: string): Promise<boolean> {
  const cols = await getSpellsColumns();
  return cols.has(col.toLowerCase());
}

async function pickCol(candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    if (await hasCol(c)) return c;
  }
  return null;
}

function selOrNull(col: string | null, asName: string, pgType: string): string {
  if (col) return `${col} AS ${asName}`;
  return `NULL::${pgType} AS ${asName}`;
}

// -------------------------
// Types (API shape)
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

  // New schema
  resource_type: string | null;
  resource_cost: number | null;

  // Legacy aliases for UI compatibility
  resource: string | null;
  cost: number | null;

  cooldown_ms: number;

  // New schema
  damage_multiplier: number | null;

  // Legacy alias
  damage_mult: number | null;

  flat_bonus: number | null;
  heal_amount: number | null;

  is_debug: boolean | null;

  // New schema
  is_enabled: boolean | null;

  // Legacy alias
  enabled: boolean | null;

  is_dev_only: boolean | null;
  grant_min_role: string | null;

  flags: any | null;
  tags: string[] | null;

  status_effect: any | null;
  cleanse: any | null;

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

  // accept both names
  resource_type?: string | null;
  resource?: string | null;

  resource_cost?: number | null;
  cost?: number | null;

  cooldown_ms?: number;

  damage_multiplier?: number | null;
  damage_mult?: number | null;

  flat_bonus?: number | null;
  heal_amount?: number | null;

  is_debug?: boolean | null;

  is_enabled?: boolean | null;
  enabled?: boolean | null;

  is_dev_only?: boolean | null;
  grant_min_role?: string | null;

  tags?: string[];
  flags?: any;
  status_effect?: any;
  cleanse?: any;
}

// -------------------------
// Routes
// -------------------------

/**
 * GET /api/admin/spells?q&limit&offset
 */
adminSpellsRouter.get("/", async (req, res) => {
  try {
    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const hasQ = qRaw.length > 0;
    const qLike = `%${qRaw}%`;

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

    const totalSql = hasQ
      ? `SELECT COUNT(*)::int AS total FROM spells WHERE (id ILIKE $1 OR name ILIKE $1)`
      : `SELECT COUNT(*)::int AS total FROM spells`;

    const totalParams = hasQ ? [qLike] : [];
    const totalRes = await db.query<{ total: number }>(totalSql, totalParams);
    const total = totalRes.rows[0]?.total ?? 0;

    // Column mapping (supports both schema variants)
    const colResourceType = await pickCol(["resource_type", "resource"]);
    const colResourceCost = await pickCol(["resource_cost", "cost"]);
    const colDamageMult = await pickCol(["damage_multiplier", "damage_mult"]);
    const colEnabled = await pickCol(["is_enabled", "enabled"]);
    const colIsDebug = await pickCol(["is_debug"]);
    const colIsDevOnly = await pickCol(["is_dev_only"]);
    const colGrantMinRole = await pickCol(["grant_min_role"]);

    const limitParam = hasQ ? 2 : 1;
    const offsetParam = hasQ ? 3 : 2;

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

        ${selOrNull(colResourceType, "resource_type", "text")},
        ${selOrNull(colResourceCost, "resource_cost", "int")},

        -- UI compatibility aliases (these MUST NOT reference missing columns)
        ${selOrNull(colResourceType, "resource", "text")},
        ${selOrNull(colResourceCost, "cost", "int")},

        cooldown_ms,

        ${selOrNull(colDamageMult, "damage_multiplier", "float")},
        ${selOrNull(colDamageMult, "damage_mult", "float")},

        flat_bonus,
        heal_amount,

        ${selOrNull(colIsDebug, "is_debug", "boolean")},

        ${selOrNull(colEnabled, "is_enabled", "boolean")},
        ${selOrNull(colEnabled, "enabled", "boolean")},

        ${selOrNull(colIsDevOnly, "is_dev_only", "boolean")},
        ${selOrNull(colGrantMinRole, "grant_min_role", "text")},

        flags,
        tags,
        status_effect,
        cleanse,

        created_at,
        updated_at
      FROM spells
      ${hasQ ? "WHERE (id ILIKE $1 OR name ILIKE $1)" : ""}
      ORDER BY id ASC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `;

    const params = hasQ ? [qLike, limit, offset] : [limit, offset];
    const qres = await db.query<AdminSpellRow>(sql, params);

    return res.json({
      ok: true,
      spells: qres.rows,
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

    const colResourceType = await pickCol(["resource_type", "resource"]);
    const colResourceCost = await pickCol(["resource_cost", "cost"]);
    const colDamageMult = await pickCol(["damage_multiplier", "damage_mult"]);
    const colEnabled = await pickCol(["is_enabled", "enabled"]);
    const colIsDebug = await pickCol(["is_debug"]);
    const colIsDevOnly = await pickCol(["is_dev_only"]);
    const colGrantMinRole = await pickCol(["grant_min_role"]);

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

        ${selOrNull(colResourceType, "resource_type", "text")},
        ${selOrNull(colResourceCost, "resource_cost", "int")},
        ${selOrNull(colResourceType, "resource", "text")},
        ${selOrNull(colResourceCost, "cost", "int")},

        cooldown_ms,

        ${selOrNull(colDamageMult, "damage_multiplier", "float")},
        ${selOrNull(colDamageMult, "damage_mult", "float")},

        flat_bonus,
        heal_amount,

        ${selOrNull(colIsDebug, "is_debug", "boolean")},

        ${selOrNull(colEnabled, "is_enabled", "boolean")},
        ${selOrNull(colEnabled, "enabled", "boolean")},

        ${selOrNull(colIsDevOnly, "is_dev_only", "boolean")},
        ${selOrNull(colGrantMinRole, "grant_min_role", "text")},

        flags,
        tags,
        status_effect,
        cleanse,

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
 * Upsert spell
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

    // accept both names for resource + cost
    const resource_type = toNullableString(input?.resource_type ?? input?.resource);
    const resource_cost_raw =
      typeof input?.resource_cost === "number"
        ? input.resource_cost
        : typeof input?.cost === "number"
        ? input.cost
        : null;
    const resource_cost = resource_cost_raw === null ? null : clampInt(resource_cost_raw, 0, 1_000_000);

    const cooldown_ms = clampInt(input?.cooldown_ms ?? 0, 0, 60 * 60 * 1000);

    const dmg_raw =
      typeof input?.damage_multiplier === "number"
        ? input.damage_multiplier
        : typeof input?.damage_mult === "number"
        ? input.damage_mult
        : null;
    const damage_multiplier = dmg_raw;

    const flat_bonus = typeof input?.flat_bonus === "number" ? input.flat_bonus : null;
    const heal_amount = typeof input?.heal_amount === "number" ? input.heal_amount : null;

    const is_debug = input?.is_debug !== undefined && input?.is_debug !== null ? !!input.is_debug : null;

    const is_enabled_input =
      input?.is_enabled !== undefined && input?.is_enabled !== null
        ? !!input.is_enabled
        : input?.enabled !== undefined && input?.enabled !== null
        ? !!input.enabled
        : null;

    const is_dev_only =
      input?.is_dev_only !== undefined && input?.is_dev_only !== null ? !!input.is_dev_only : null;

    const grant_min_role = toNullableString(input?.grant_min_role);

    const tags = Array.isArray(input?.tags)
      ? input.tags.filter((t) => typeof t === "string")
      : null;

    const flagsJson = parseJsonOrNull(input?.flags ?? null);
    const statusEffectJson = parseJsonOrNull(input?.status_effect ?? null);
    const cleanseJson = parseJsonOrNull(input?.cleanse ?? null);

    // Determine actual columns present
    const colResourceType = await pickCol(["resource_type", "resource"]);
    const colResourceCost = await pickCol(["resource_cost", "cost"]);
    const colDamageMult = await pickCol(["damage_multiplier", "damage_mult"]);
    const colEnabled = await pickCol(["is_enabled", "enabled"]);
    const colIsDebug = await pickCol(["is_debug"]);
    const colIsDevOnly = await pickCol(["is_dev_only"]);
    const colGrantMinRole = await pickCol(["grant_min_role"]);

    // Build INSERT/UPSERT dynamically so missing columns never explode.
    const insertCols: string[] = [
      "id",
      "name",
      "description",
      "kind",
      "class_id",
      "min_level",
      "school",
      "is_song",
      "song_school",
      "cooldown_ms",
      "flat_bonus",
      "heal_amount",
      "flags",
      "tags",
      "status_effect",
      "cleanse",
    ];

    if (colResourceType) insertCols.push(colResourceType);
    if (colResourceCost) insertCols.push(colResourceCost);
    if (colDamageMult) insertCols.push(colDamageMult);
    if (colEnabled) insertCols.push(colEnabled);
    if (colIsDebug) insertCols.push(colIsDebug);
    if (colIsDevOnly) insertCols.push(colIsDevOnly);
    if (colGrantMinRole) insertCols.push(colGrantMinRole);

    const params: any[] = [];
    const pushParam = (v: any) => {
      params.push(v);
      return `$${params.length}`;
    };

    const valuesByCol: Record<string, string> = {
      id: pushParam(id),
      name: pushParam(name),
      description: pushParam(description),
      kind: pushParam(kind),
      class_id: pushParam(class_id),
      min_level: pushParam(min_level),
      school: pushParam(school),
      is_song: pushParam(is_song),
      song_school: pushParam(song_school),
      cooldown_ms: pushParam(cooldown_ms),
      flat_bonus: pushParam(flat_bonus),
      heal_amount: pushParam(heal_amount),

      flags: `${pushParam(flagsJson === null ? null : JSON.stringify(flagsJson))}::jsonb`,
      tags: tags === null ? pushParam(null) : `${pushParam(tags)}::text[]`,
      status_effect: `${pushParam(
        statusEffectJson === null ? null : JSON.stringify(statusEffectJson)
      )}::jsonb`,
      cleanse: `${pushParam(cleanseJson === null ? null : JSON.stringify(cleanseJson))}::jsonb`,
    };

    if (colResourceType) valuesByCol[colResourceType] = pushParam(resource_type);
    if (colResourceCost) valuesByCol[colResourceCost] = pushParam(resource_cost);
    if (colDamageMult) valuesByCol[colDamageMult] = pushParam(damage_multiplier);
    if (colEnabled) valuesByCol[colEnabled] = pushParam(is_enabled_input);
    if (colIsDebug) valuesByCol[colIsDebug] = pushParam(is_debug);
    if (colIsDevOnly) valuesByCol[colIsDevOnly] = pushParam(is_dev_only);
    if (colGrantMinRole) valuesByCol[colGrantMinRole] = pushParam(grant_min_role);

    const valuesSql = insertCols.map((c) => valuesByCol[c]).join(",\n        ");

    const updateCols = insertCols.filter((c) => c !== "id");
    const updateSql = updateCols.map((c) => `        ${c} = EXCLUDED.${c}`).join(",\n");

    // Returning list (always returns aliases for UI)
    const returningSql = `
        id,
        name,
        description,
        kind,
        class_id,
        min_level,
        school,
        is_song,
        song_school,

        ${selOrNull(colResourceType, "resource_type", "text")},
        ${selOrNull(colResourceCost, "resource_cost", "int")},
        ${selOrNull(colResourceType, "resource", "text")},
        ${selOrNull(colResourceCost, "cost", "int")},

        cooldown_ms,

        ${selOrNull(colDamageMult, "damage_multiplier", "float")},
        ${selOrNull(colDamageMult, "damage_mult", "float")},

        flat_bonus,
        heal_amount,

        ${selOrNull(colIsDebug, "is_debug", "boolean")},
        ${selOrNull(colEnabled, "is_enabled", "boolean")},
        ${selOrNull(colEnabled, "enabled", "boolean")},

        ${selOrNull(colIsDevOnly, "is_dev_only", "boolean")},
        ${selOrNull(colGrantMinRole, "grant_min_role", "text")},

        flags,
        tags,
        status_effect,
        cleanse,

        created_at,
        updated_at
    `;

    const sql = `
      INSERT INTO spells (
        ${insertCols.join(",\n        ")}
      )
      VALUES (
        ${valuesSql}
      )
      ON CONFLICT (id) DO UPDATE SET
${updateSql},
        updated_at = NOW()
      RETURNING
${returningSql}
    `;

    const qres = await db.query<AdminSpellRow>(sql, params);
    const row = qres.rows[0];
    if (!row) return res.status(500).json({ ok: false, error: "Upsert failed" });

    return res.json({ ok: true, spell: row });
  } catch (err) {
    console.error("[adminSpellsRouter.post /] error", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});
