// worldcore/abilities/AbilityUnlocks.ts
//
// DB-driven ability unlock rules (mirrors spells/SpellUnlocks).
//
// Canonical abilityId is the ABILITIES map key.
// We tolerate aliases (AbilityDefinition.id, display name, case variants), but
// normalize on ingestion so downstream code can do simple equality checks.

import { Logger } from "../utils/logger";
import { ABILITIES } from "./AbilityTypes";

const log = Logger.scope("ABILITY_UNLOCKS");

export type AbilityUnlockRule = {
  classId: string; // "any" or exact class id
  abilityId: string; // canonical ability key (ABILITIES map key)
  minLevel: number;
  autoGrant: boolean;
  isEnabled?: boolean; // default true if omitted
  notes?: string;
};

export type PgPoolLoose = {
  query?: (text: string, params?: any[]) => Promise<{ rows?: any[] }>;
};

// --- Fallback rules (safe if DB table is missing/empty) ---
const FALLBACK_UNLOCKS: AbilityUnlockRule[] = Object.entries(ABILITIES)
  .map(([key, def]: any) => ({
    classId: String(def?.classId ?? "any"),
    abilityId: String(key),
    minLevel: Number(def?.minLevel ?? 1),
    autoGrant: true,
    isEnabled: true,
    notes: "fallback:auto",
  }))
  .filter((r) => !!r.abilityId);

let unlocks: AbilityUnlockRule[] = [...FALLBACK_UNLOCKS];
let unlockSource: "code" | "db" | "test" = "code";
let dbInitPromise: Promise<void> | null = null;
let testOverride: AbilityUnlockRule[] | null = null;

/**
 * Resolve a raw id/name into the canonical ABILITIES map key.
 * - Accepts the map key itself
 * - Accepts AbilityDefinition.id
 * - Accepts exact (case-insensitive) display name
 */
export function resolveAbilityKey(raw: string): string | null {
  const q = String(raw ?? "").trim();
  if (!q) return null;
  if ((ABILITIES as any)[q]) return q;

  const qLower = q.toLowerCase();

  // Case-insensitive key match
  for (const key of Object.keys(ABILITIES as any)) {
    if (key.toLowerCase() === qLower) return key;
  }

  // AbilityDefinition.id match (exact / case-insensitive)
  for (const [key, def] of Object.entries(ABILITIES as any)) {
    const id = String((def as any)?.id ?? "").trim();
    if (!id) continue;
    if (id === q || id.toLowerCase() === qLower) return String(key);
  }

  // Display name match (exact / case-insensitive)
  for (const [key, def] of Object.entries(ABILITIES as any)) {
    const name = String((def as any)?.name ?? "").trim();
    if (!name) continue;
    if (name === q || name.toLowerCase() === qLower) return String(key);
  }

  return null;
}

function enabled(r: AbilityUnlockRule): boolean {
  return r.isEnabled !== false;
}

function safeRows(res: any): any[] {
  const rows = res?.rows;
  return Array.isArray(rows) ? rows : [];
}

function asStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}

function asNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function requireQuery(pool: PgPoolLoose): (text: string, params?: any[]) => Promise<any> {
  const q = (pool as any)?.query;
  if (typeof q !== "function") {
    throw new Error("AbilityUnlocks: pool.query is not a function (DB pool not initialized?)");
  }
  return q.bind(pool as any);
}

function normalizeRule(input: any): AbilityUnlockRule | null {
  const rawAbilityId = asStr(input?.abilityId ?? input?.ability_id ?? "", "").trim();
  if (!rawAbilityId) return null;

  const canonical = resolveAbilityKey(rawAbilityId) ?? rawAbilityId;

  const rule: AbilityUnlockRule = {
    classId: asStr(input?.classId ?? input?.class_id ?? "any", "any"),
    abilityId: canonical,
    minLevel: asNum(input?.minLevel ?? input?.min_level, 1) || 1,
    autoGrant: asBool(input?.autoGrant ?? input?.auto_grant),
    isEnabled: input?.isEnabled == null && input?.is_enabled == null ? true : asBool(input?.isEnabled ?? input?.is_enabled),
    notes: typeof input?.notes === "string" ? input.notes : undefined,
  };

  // Normalize classId casing
  rule.classId = String(rule.classId ?? "any").toLowerCase().trim() || "any";

  return rule;
}

export function getAbilityUnlockSource(): "code" | "db" | "test" {
  return unlockSource;
}

export function getAllAbilityUnlockRules(): AbilityUnlockRule[] {
  // Rules stored in unlocks/testOverride are already normalized.
  return testOverride ? [...testOverride] : [...unlocks];
}

export function getAutoGrantAbilityUnlocksFor(classId: string, level: number): AbilityUnlockRule[] {
  const cid = String(classId ?? "").toLowerCase().trim();
  const lvl = Math.max(1, Number.isFinite(Number(level)) ? Number(level) : 1);

  return getAllAbilityUnlockRules()
    .filter((r) => r && enabled(r) && r.autoGrant)
    .filter((r) => {
      const rc = String(r.classId ?? "any").toLowerCase().trim();
      return rc === "any" || rc === cid;
    })
    .filter((r) => (Number(r.minLevel) || 1) <= lvl)
    .sort((a, b) => a.minLevel - b.minLevel || a.abilityId.localeCompare(b.abilityId));
}

export function getLearnableAbilityUnlocksFor(classId: string, level: number): AbilityUnlockRule[] {
  const cid = String(classId ?? "").toLowerCase().trim();
  const lvl = Math.max(1, Number.isFinite(Number(level)) ? Number(level) : 1);

  return getAllAbilityUnlockRules()
    .filter((r) => r && enabled(r) && !r.autoGrant)
    .filter((r) => {
      const rc = String(r.classId ?? "any").toLowerCase().trim();
      return rc === "any" || rc === cid;
    })
    .filter((r) => (Number(r.minLevel) || 1) <= lvl)
    .sort((a, b) => a.minLevel - b.minLevel || a.abilityId.localeCompare(b.abilityId));
}

/**
 * Load unlock rules from DB (once).
 *
 * Table: public.ability_unlocks
 * Columns: class_id, ability_id, min_level, auto_grant, is_enabled, notes
 */
export async function initAbilityUnlocksFromDbOnce(pool: PgPoolLoose): Promise<void> {
  if (process.env.WORLDCORE_TEST === "1") return;
  if (testOverride) return;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    try {
      const query = requireQuery(pool);
      const res = await query(
        `SELECT class_id, ability_id, min_level, auto_grant, is_enabled, notes
         FROM public.ability_unlocks
         ORDER BY class_id, min_level, ability_id`,
      );

      const rows = safeRows(res);
      if (!rows.length) {
        unlocks = [...FALLBACK_UNLOCKS];
        unlockSource = "code";
        log.info("ability_unlocks table empty; keeping fallback rules");
        return;
      }

      const loaded: AbilityUnlockRule[] = [];
      for (const row of rows) {
        const rule = normalizeRule({
          class_id: row.class_id,
          ability_id: row.ability_id,
          min_level: row.min_level,
          auto_grant: row.auto_grant,
          is_enabled: row.is_enabled,
          notes: row.notes,
        });
        if (!rule) continue;
        loaded.push(rule);
      }

      if (loaded.length) {
        unlocks = loaded;
        unlockSource = "db";
        log.info("loaded ability unlock rules from DB", { count: loaded.length });
      } else {
        unlocks = [...FALLBACK_UNLOCKS];
        unlockSource = "code";
        log.info("ability unlock rules failed to parse; keeping fallback");
      }
    } catch (err: any) {
      // Missing table or DB not ready: keep safe fallback.
      unlocks = [...FALLBACK_UNLOCKS];
      unlockSource = "code";
      log.warn("ability unlock DB init failed; using fallback", { err: String(err?.message ?? err) });
    }
  })();

  return dbInitPromise;
}

export function __setAbilityUnlocksForTest(rules: AbilityUnlockRule[]): void {
  // Tests may provide abilityId as canonical key OR AbilityDefinition.id.
  // Normalize everything so AbilityLearning can do strict equality.
  const normalized: AbilityUnlockRule[] = [];
  for (const r of rules ?? []) {
    const rule = normalizeRule(r);
    if (!rule) continue;
    normalized.push(rule);
  }

  testOverride = normalized;
  unlockSource = "test";
}

export function __resetAbilityUnlocksForTest(): void {
  testOverride = null;
  unlockSource = "code";
  unlocks = [...FALLBACK_UNLOCKS];
  dbInitPromise = null;
}
