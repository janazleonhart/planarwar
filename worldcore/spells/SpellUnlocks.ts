// worldcore/spells/SpellUnlocks.ts
//
// DB-driven spell/song unlock rules for Spellbook auto-grants.
// This keeps SpellTypes focused on "what a spell is" while this module answers
// "who gets it and when".
//
// Design goals:
// - Safe fallback: if DB is missing/empty, keep a tiny code-defined unlock list
//   so new characters remain playable.
// - Idempotent init: load once per process.
// - Test-friendly: allow tests to override unlock rules without touching DB.

import { Logger } from "../utils/logger";

const log = Logger.scope("SPELL_UNLOCKS");

export type SpellUnlockRule = {
  classId: string;       // "any" or exact classId (e.g. "mage", "virtuoso")
  spellId: string;       // canonical id (aliases are tolerated but will be resolved by SpellTypes)
  minLevel: number;      // level requirement
  autoGrant: boolean;    // whether ensureSpellbookAutogrants should add it
  isEnabled: boolean;    // DB toggle
  notes?: string;
};

export type PgPoolLoose = {
  query?: (text: string, params?: any[]) => Promise<{ rows?: any[] }>;
};

const FALLBACK_UNLOCKS: SpellUnlockRule[] = [
  // Universal starter spell
  { classId: "any", spellId: "arcane_bolt", minLevel: 1, autoGrant: true, isEnabled: true },

  // Minimal class identity starters
  { classId: "mage", spellId: "mage_fire_bolt", minLevel: 1, autoGrant: true, isEnabled: true },
  { classId: "cleric", spellId: "cleric_minor_heal", minLevel: 1, autoGrant: true, isEnabled: true },

  // Virtuoso songs (MVP)
  { classId: "virtuoso", spellId: "virtuoso_song_rising_courage", minLevel: 1, autoGrant: true, isEnabled: true },
  { classId: "virtuoso", spellId: "virtuoso_hymn_woven_recovery", minLevel: 3, autoGrant: true, isEnabled: true },
  { classId: "virtuoso", spellId: "virtuoso_dissonant_battle_chant", minLevel: 5, autoGrant: true, isEnabled: true },
];

let unlocks: SpellUnlockRule[] = [...FALLBACK_UNLOCKS];
let unlockSource: "code" | "db" | "test" = "code";
let dbInitPromise: Promise<void> | null = null;
let testOverride: SpellUnlockRule[] | null = null;

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
    throw new Error("SpellUnlocks: pool.query is not a function (DB pool not initialized?)");
  }
  return q.bind(pool as any);
}

export function getSpellUnlockSource(): "code" | "db" | "test" {
  return unlockSource;
}

export function getAllSpellUnlockRules(): SpellUnlockRule[] {
  // If tests override, return that, otherwise current unlock set.
  return testOverride ? [...testOverride] : [...unlocks];
}

export function getAutoGrantUnlocksFor(classId: string, level: number): SpellUnlockRule[] {
  const cid = (classId || "").toLowerCase().trim();
  const lvl = Math.max(1, Number.isFinite(Number(level)) ? Number(level) : 1);

  const rules = getAllSpellUnlockRules()
    .filter((r) => r && r.isEnabled && r.autoGrant)
    .filter((r) => (r.classId || "").toLowerCase().trim() === "any" || (r.classId || "").toLowerCase().trim() === cid)
    .filter((r) => (Number(r.minLevel) || 1) <= lvl)
    .sort((a, b) => (a.minLevel - b.minLevel) || a.spellId.localeCompare(b.spellId));

  return rules;
}

/**
 * Load unlock rules from DB (once).
 *
 * Table: public.spell_unlocks
 * Columns: class_id, spell_id, min_level, auto_grant, is_enabled, notes
 */
export async function initSpellUnlocksFromDbOnce(pool: PgPoolLoose): Promise<void> {
  if (process.env.WORLDCORE_TEST === "1") return;
  if (testOverride) return; // tests controlling unlocks; don't clobber

  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    try {
      const query = requireQuery(pool);

      const res = await query(`
        SELECT
          class_id,
          spell_id,
          min_level,
          auto_grant,
          is_enabled,
          notes
        FROM public.spell_unlocks
        WHERE is_enabled = true
      `);

      const rows = safeRows(res);

      if (rows.length === 0) {
        log.warn("DB spell_unlocks returned 0 rows; keeping code fallback unlock list.");
        unlocks = [...FALLBACK_UNLOCKS];
        unlockSource = "code";
        return;
      }

      const loaded: SpellUnlockRule[] = [];
      for (const r of rows) {
        const rule: SpellUnlockRule = {
          classId: asStr(r?.class_id).toLowerCase().trim(),
          spellId: asStr(r?.spell_id).trim(),
          minLevel: Math.max(1, asNum(r?.min_level, 1)),
          autoGrant: asBool(r?.auto_grant),
          isEnabled: asBool(r?.is_enabled),
          notes: r?.notes ? asStr(r?.notes) : undefined,
        };

        if (!rule.classId || !rule.spellId) continue;
        loaded.push(rule);
      }

      if (loaded.length === 0) {
        log.warn("DB spell_unlocks rows were not usable; keeping code fallback unlock list.");
        unlocks = [...FALLBACK_UNLOCKS];
        unlockSource = "code";
        return;
      }

      unlocks = loaded;
      unlockSource = "db";

      log.info("Loaded spell unlock rules from DB", {
        count: loaded.length,
      });
    } catch (err: any) {
      // Missing table: 42P01, others: keep fallback
      const code = String(err?.code ?? "");
      const msg = String(err?.message ?? err);

      if (code === "42P01" || /relation .*spell_unlocks.* does not exist/i.test(msg)) {
        log.warn("DB spell_unlocks table not found; keeping code fallback unlock list.", {
          code,
          message: msg,
        });
      } else {
        log.warn("DB spell_unlocks load failed; keeping code fallback unlock list.", {
          code,
          message: msg,
        });
      }

      unlocks = [...FALLBACK_UNLOCKS];
      unlockSource = "code";
    }
  })();

  return dbInitPromise;
}

/**
 * Test helper: override unlock rules for deterministic unit tests.
 * (Do not use in production code.)
 */
export function __setSpellUnlocksForTest(rules: SpellUnlockRule[]): void {
  testOverride = Array.isArray(rules) ? [...rules] : [];
  unlockSource = "test";
}

/**
 * Test helper: clear overrides and restore current unlock set.
 */
export function __resetSpellUnlocksForTest(): void {
  testOverride = null;
  // Do not auto-flip source to db here; keep what init set or fallback.
  if (unlockSource === "test") unlockSource = (unlocks.length ? unlockSource : "code");
}
