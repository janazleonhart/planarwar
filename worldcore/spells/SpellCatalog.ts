// worldcore/spells/SpellCatalog.ts
//
// DB-backed spell/song catalog loader (definitions + aliases).
//
// IMPORTANT (TS compatibility):
// Some environments type the Postgres pool as `any` or as a minimal/incorrect shape,
// which makes TypeScript unhappy if we demand a strict `{ query: ... }` type.
// To avoid ts2345/ts2347 friction, we accept a very loose Pool-like input and then
// validate `query` at runtime.
//
// This module is transition-safe: if the DB tables are missing/empty, callers can
// keep using the in-code fallback spell map.

export type DbSpellRow = {
  id: string;
  name: string;
  description: string;
  kind: string;
  class_id: string;
  min_level: number;
  school: string | null;

  is_song: boolean;
  song_school: string | null;

  resource_type: string | null;
  resource_cost: number | null;
  cooldown_ms: number | null;

  damage_multiplier: number | null;
  flat_bonus: number | null;
  heal_amount: number | null;

  // Optional JSON payloads
  status_effect?: any | null;
  cleanse?: any | null;

  // Optional metadata
  flags?: any | null;
  tags?: string[] | null;
  is_debug: boolean;
  is_dev_only: boolean;
  is_enabled: boolean;

  grant_min_role?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
};

export type DbAliasRow = {
  alias_id: string;
  spell_id: string;
};

export type SpellCatalogLoadResult<SpellDefinition> = {
  defsById: Record<string, SpellDefinition>;
  aliases: Record<string, string>;
};

/**
 * "Pool-like" shape used by this module.
 * We keep it intentionally loose to avoid TS mismatch across environments.
 */
export type PgPoolLike = {
  // optional to avoid structural type rejections in some TS setups;
  // we validate presence at runtime.
  query?: (text: string, params?: any[]) => Promise<{ rows?: any[] }>;
};

function asStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}

function asNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function safeRows(res: any): any[] {
  const rows = res?.rows;
  return Array.isArray(rows) ? rows : [];
}

function requireQuery(pool: PgPoolLike): (text: string, params?: any[]) => Promise<any> {
  const q = (pool as any)?.query;
  if (typeof q !== "function") {
    throw new Error("SpellCatalog: pool.query is not a function (DB pool not initialized?)");
  }
  return q.bind(pool as any);
}

/**
 * Load spell definitions and alias mappings from Postgres.
 *
 * Expected tables (see migrations):
 * - public.spells
 * - public.spell_aliases
 */
export async function loadSpellCatalogFromDb<SpellDefinition extends Record<string, any>>(
  pool: PgPoolLike,
  mapRowToDef: (row: DbSpellRow) => SpellDefinition,
): Promise<SpellCatalogLoadResult<SpellDefinition>> {
  const defsById: Record<string, SpellDefinition> = {};
  const aliases: Record<string, string> = {};

  const query = requireQuery(pool);

  // 1) spells
  const spellsRes = await query(`
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
      is_debug,
      is_dev_only,
      is_enabled
    FROM public.spells
    WHERE is_enabled = true
  `);

  for (const r of safeRows(spellsRes)) {
    // normalize row fields defensively
    const row: DbSpellRow = {
      id: asStr(r?.id).trim(),
      name: asStr(r?.name).trim(),
      description: asStr(r?.description, "").trim(),
      kind: asStr(r?.kind).trim(),
      class_id: asStr(r?.class_id).trim(),
      min_level: asNum(r?.min_level, 1),
      school: r?.school ?? null,

      is_song: asBool(r?.is_song),
      song_school: r?.song_school ?? null,

      resource_type: r?.resource_type ?? null,
      resource_cost: asNum(r?.resource_cost, 0),
      cooldown_ms: asNum(r?.cooldown_ms, 0),

      damage_multiplier: (r?.damage_multiplier ?? null) as any,
      flat_bonus: (r?.flat_bonus ?? null) as any,
      heal_amount: (r?.heal_amount ?? null) as any,

      is_debug: asBool(r?.is_debug),
      is_dev_only: asBool(r?.is_dev_only),
      is_enabled: asBool(r?.is_enabled),

      // raw JSONB + arrays (kept flexible)
      flags: (r?.flags ?? {}) as any,
      tags: (Array.isArray(r?.tags) ? r?.tags : []) as any,

      created_at: (r?.created_at ?? null) as any,
      updated_at: (r?.updated_at ?? null) as any,

      grant_min_role: asStr(r?.grant_min_role, "player"),
      // denormalized helpers for consumers
      status_effect: (r?.status_effect ?? null) as any,
      cleanse: (r?.cleanse ?? null) as any,
    };

    if (!row.id) continue;
    defsById[row.id] = mapRowToDef(row);
  }

  // 2) aliases
  const aliasRes = await query(`
    SELECT alias_id, spell_id
    FROM public.spell_aliases
  `);

  for (const a of safeRows(aliasRes)) {
    const aliasId = asStr(a?.alias_id).trim();
    const spellId = asStr(a?.spell_id).trim();
    if (!aliasId || !spellId) continue;
    aliases[aliasId] = spellId;
  }

  return { defsById, aliases };
}
