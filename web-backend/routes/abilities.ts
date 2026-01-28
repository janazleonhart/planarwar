// web-backend/routes/abilities.ts
//
// Abilities metadata endpoint.
//
// Supports:
//   GET /api/abilities?classId=warrior&level=8
//     -> returns unlocked abilities for that class at that level (from DB ability_unlocks)
//        enriched with metadata from the abilities catalog table when present.
//
//   GET /api/abilities?ids=power_strike,savage_strike
//     -> returns metadata for the requested ability ids (best-effort)
//        (DB abilities table if present, else worldcore ability defs).
//
// The route also tolerates class-prefixed ids like warrior_power_strike (UI-only alias):
// it will try the full id first, then strip the prefix and enrich from the base id.

import express, { type Request, type Response } from "express";
import { Pool } from "pg";

// Best-effort enrichment from worldcore definitions.
// Mechanics remain code-defined; DB provides metadata overrides when present.
import { ABILITIES } from "../../worldcore/abilities/AbilityTypes";

type AbilityUnlockRow = {
  class_id: string;
  ability_id: string;
  min_level: number;
  auto_grant: boolean;
  is_enabled: boolean;
  notes: string | null;
};

type AbilityCatalogRow = {
  id: string;
  name: string;
  description: string;
  kind?: string;
  resource_type?: string | null;
  resource_cost?: number | null;
  cooldown_ms?: number | null;
  is_enabled?: boolean;
  is_dev_only?: boolean;
  grant_min_role?: string;
  flags?: any;
  tags?: string;
};

export type AbilityMetaRow = {
  id: string;
  name: string;
  description: string | null;
  classId?: string;
  minLevel?: number;
  autoGrant?: boolean;
  isEnabled?: boolean;
  cooldownMs?: number | null;
  resourceCost?: number | null;
  resourceType?: string | null;
  grantMinRole?: string;
  isDevOnly?: boolean;
  flags?: any;
  tags?: string;

  // Debug / UI: always keep the original request id.
  rawId?: string;
  notes?: string | null;
};

function parseCsvParam(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toInt(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function titleFromId(id: string): string {
  return String(id ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function splitPrefixedAbilityId(rawId: string): { primary: string; base: string | null } {
  const s = String(rawId ?? "").trim();
  if (!s) return { primary: "", base: null };
  const idx = s.indexOf("_");
  if (idx <= 0) return { primary: s, base: null };
  return { primary: s, base: s.slice(idx + 1) };
}

function enrichFromWorldcore(id: string): Partial<AbilityMetaRow> {
  const def: any = (ABILITIES as any)[id];
  if (!def) {
    return {
      id,
      name: titleFromId(id) || id,
      description: null,
      cooldownMs: null,
      resourceCost: null,
      resourceType: null,
    };
  }

  return {
    id,
    name: def?.name ?? titleFromId(id) ?? id,
    description: typeof def?.description === "string" ? def.description : null,
    cooldownMs: typeof def?.cooldownMs === "number" ? def.cooldownMs : null,
    resourceCost: typeof def?.resourceCost === "number" ? def.resourceCost : null,
    resourceType: typeof def?.resourceType === "string" ? def.resourceType : null,
  };
}

function mergeMeta(rawId: string, catalog?: Partial<AbilityCatalogRow> | null): AbilityMetaRow {
  const { primary, base } = splitPrefixedAbilityId(rawId);
  const wcPrimary = enrichFromWorldcore(primary);
  const wcBase = base ? enrichFromWorldcore(base) : null;

  const cat = catalog ?? null;

  // Prefer catalog values, but backfill missing/empty fields from code defs.
  const name = (cat?.name && String(cat.name).trim())
    ? String(cat.name)
    : (wcPrimary.name || wcBase?.name || titleFromId(rawId) || rawId);

  const desc = (cat?.description && String(cat.description).trim())
    ? String(cat.description)
    : (wcPrimary.description || wcBase?.description || null);

  const cooldownMs = (typeof cat?.cooldown_ms === "number") ? cat.cooldown_ms : (wcPrimary.cooldownMs ?? wcBase?.cooldownMs ?? null);
  const resourceCost = (typeof cat?.resource_cost === "number") ? cat.resource_cost : (wcPrimary.resourceCost ?? wcBase?.resourceCost ?? null);
  const resourceType = (typeof cat?.resource_type === "string") ? cat.resource_type : (wcPrimary.resourceType ?? wcBase?.resourceType ?? null);

  const out: AbilityMetaRow = {
    id: String(cat?.id ?? base ?? primary ?? rawId),
    name,
    description: desc,
    cooldownMs,
    resourceCost,
    resourceType,
    isEnabled: cat?.is_enabled ?? true,
    isDevOnly: cat?.is_dev_only ?? false,
    grantMinRole: (typeof cat?.grant_min_role === "string" && cat.grant_min_role.trim()) ? cat.grant_min_role : "player",
    flags: cat?.flags ?? {},
    tags: typeof cat?.tags === "string" ? cat.tags : "",
    rawId,
  };

  return out;
}

const router = express.Router();

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
    "routes/abilities: Postgres is not configured. Set PW_DATABASE_URL (or DATABASE_URL / POSTGRES_URL / PG_URL) or PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGPORT.",
  );
}

let _abilitiesColumns: Set<string> | null = null;
let _abilitiesTableChecked: boolean | null = null;

async function loadAbilitiesColumns(db: Pool): Promise<Set<string>> {
  if (_abilitiesColumns) return _abilitiesColumns;

  // First: does the table exist?
  if (_abilitiesTableChecked === null) {
    try {
      const t = await db.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='abilities' LIMIT 1;",
      );
      _abilitiesTableChecked = (t.rows?.length ?? 0) > 0;
    } catch {
      _abilitiesTableChecked = false;
    }
  }

  if (!_abilitiesTableChecked) {
    _abilitiesColumns = new Set();
    return _abilitiesColumns;
  }

  const res = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='abilities';",
  );
  const cols = new Set<string>();
  for (const r of res.rows ?? []) {
    if (r?.column_name) cols.add(String(r.column_name));
  }

  _abilitiesColumns = cols;
  return cols;
}

function has(cols: Set<string>, col: string): boolean {
  return cols.has(col);
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const ids = parseCsvParam(req.query.ids);
    const classId = typeof req.query.classId === "string" ? req.query.classId.trim().toLowerCase() : "";
    const level = toInt(req.query.level);

    // (A) Direct lookup by ids (best-effort; DB optional).
    if (ids.length > 0) {
      let catalogById = new Map<string, AbilityCatalogRow>();

      try {
        const db = getPool();
        const cols = await loadAbilitiesColumns(db);

        if (cols.size > 0) {
          const selectCols = [
            "id",
            "name",
            "description",
            has(cols, "kind") ? "kind" : "''::text AS kind",
            has(cols, "resource_type") ? "resource_type" : "NULL::text AS resource_type",
            has(cols, "resource_cost") ? "resource_cost" : "NULL::integer AS resource_cost",
            has(cols, "cooldown_ms") ? "cooldown_ms" : "NULL::integer AS cooldown_ms",
            has(cols, "is_enabled") ? "is_enabled" : "true AS is_enabled",
            has(cols, "is_dev_only") ? "is_dev_only" : "false AS is_dev_only",
            has(cols, "grant_min_role") ? "grant_min_role" : "'player'::text AS grant_min_role",
            has(cols, "flags") ? "flags" : "'{}'::jsonb AS flags",
            has(cols, "tags") ? "tags" : "''::text AS tags",
          ].join(", ");

          const q = `SELECT ${selectCols} FROM public.abilities WHERE id = ANY($1::text[]);`;
          const qres = await db.query(q, [ids]);
          for (const row of qres.rows as any[]) {
            catalogById.set(String(row.id), row as AbilityCatalogRow);
          }
        }
      } catch {
        // No DB or no abilities table: fall back to code enrichment only.
      }

      const abilities: AbilityMetaRow[] = ids.map((rawId) => {
        const { primary, base } = splitPrefixedAbilityId(rawId);
        const fromCatalog = catalogById.get(primary) ?? (base ? catalogById.get(base) : undefined) ?? null;
        return mergeMeta(rawId, fromCatalog);
      });

      return res.json({ ok: true, abilities });
    }

    // (B) Unlock lookup by class+level (DB-driven, but catalog optional).
    if (classId && level !== null) {
      const db = getPool();
      const cols = await loadAbilitiesColumns(db);

      // If abilities table exists, join it. Otherwise just read unlocks and enrich from code.
      if (cols.size > 0) {
        const selectCols = [
          "au.class_id",
          "au.ability_id",
          "au.min_level",
          "au.auto_grant",
          "au.is_enabled",
          "au.notes",
          "a.id AS a_id",
          "a.name AS a_name",
          "a.description AS a_description",
          has(cols, "resource_type") ? "a.resource_type" : "NULL::text AS resource_type",
          has(cols, "resource_cost") ? "a.resource_cost" : "NULL::integer AS resource_cost",
          has(cols, "cooldown_ms") ? "a.cooldown_ms" : "NULL::integer AS cooldown_ms",
          has(cols, "is_dev_only") ? "a.is_dev_only" : "false AS is_dev_only",
          has(cols, "grant_min_role") ? "a.grant_min_role" : "'player'::text AS grant_min_role",
          has(cols, "flags") ? "a.flags" : "'{}'::jsonb AS flags",
          has(cols, "tags") ? "a.tags" : "''::text AS tags",
        ].join(", ");

        const q = `
          SELECT ${selectCols}
            FROM public.ability_unlocks au
            LEFT JOIN public.abilities a ON a.id = au.ability_id
           WHERE au.class_id = $1
             AND au.is_enabled = true
             AND au.min_level <= $2
           ORDER BY au.min_level ASC, au.ability_id ASC;
        `;

        const qres = await db.query(q, [classId, level]);

        const abilities: AbilityMetaRow[] = (qres.rows as any[]).map((r) => {
          const catalog: Partial<AbilityCatalogRow> | null = r?.a_id
            ? {
                id: String(r.a_id),
                name: String(r.a_name ?? ""),
                description: String(r.a_description ?? ""),
                resource_type: r.resource_type ?? null,
                resource_cost: r.resource_cost ?? null,
                cooldown_ms: r.cooldown_ms ?? null,
                is_dev_only: Boolean(r.is_dev_only),
                grant_min_role: String(r.grant_min_role ?? "player"),
                flags: r.flags ?? {},
                tags: String(r.tags ?? ""),
              }
            : null;

          const merged = mergeMeta(String(r.ability_id), catalog);
          merged.classId = String(r.class_id);
          merged.minLevel = Number(r.min_level) || 1;
          merged.autoGrant = Boolean(r.auto_grant);
          merged.isEnabled = Boolean(r.is_enabled);
          merged.notes = r.notes ?? null;
          merged.rawId = String(r.ability_id);

          return merged;
        });

        return res.json({ ok: true, abilities });
      }

      // No abilities table: query unlocks only and enrich from worldcore.
      const q = `
        SELECT class_id, ability_id, min_level, auto_grant, is_enabled, notes
          FROM public.ability_unlocks
         WHERE class_id = $1
           AND is_enabled = true
           AND min_level <= $2
         ORDER BY min_level ASC, ability_id ASC;
      `;
      const qres = await db.query(q, [classId, level]);
      const rows = qres.rows as AbilityUnlockRow[];

      const abilities: AbilityMetaRow[] = rows.map((r) => {
        const merged = mergeMeta(String(r.ability_id), null);
        merged.classId = String(r.class_id);
        merged.minLevel = Number(r.min_level) || 1;
        merged.autoGrant = Boolean(r.auto_grant);
        merged.isEnabled = Boolean(r.is_enabled);
        merged.notes = r.notes ?? null;
        merged.rawId = String(r.ability_id);
        return merged;
      });

      return res.json({ ok: true, abilities });
    }

    // (C) Nothing supplied.
    return res.status(400).json({ ok: false, error: "Provide either ids=... or classId=...&level=..." });
  } catch (err: any) {
    console.error("[abilities] error", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
