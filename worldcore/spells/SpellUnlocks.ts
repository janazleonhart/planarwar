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
//
// System 5.4 note:
// - During WORLDCORE_TEST runs we *always* layer in Reference Kits (L1–10) spell entries
//   so contract tests can validate autogrant behavior without requiring DB access.

import { Logger } from "../utils/logger";
import { REFERENCE_CLASS_KITS_L1_10 } from "./ReferenceKits";

const log = Logger.scope("SPELL_UNLOCKS");

export type SpellUnlockRule = {
  classId: string; // "any" or exact classId (e.g. "mage", "virtuoso")
  spellId: string; // canonical id (aliases are tolerated but will be resolved by SpellTypes)
  minLevel: number; // level requirement
  autoGrant: boolean; // whether ensureSpellbookAutogrants should add it
  isEnabled: boolean; // DB toggle
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

  // Hunter starter kit (fallback; full kit comes from DB/reference kits)
  { classId: "hunter", spellId: "hunter_steady_shot", minLevel: 1, autoGrant: true, isEnabled: true },
  { classId: "hunter", spellId: "hunter_serrated_arrow", minLevel: 3, autoGrant: true, isEnabled: true },
  { classId: "hunter", spellId: "hunter_field_dressing", minLevel: 5, autoGrant: true, isEnabled: true },

  // Outrider starter kit (fallback; full kit comes from DB/reference kits)
  { classId: "outrider", spellId: "outrider_quick_shot", minLevel: 1, autoGrant: true, isEnabled: true },
  { classId: "outrider", spellId: "outrider_barbed_arrow", minLevel: 3, autoGrant: true, isEnabled: true },
  { classId: "outrider", spellId: "outrider_evasive_roll", minLevel: 5, autoGrant: true, isEnabled: true },

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

function uniqRules(rules: SpellUnlockRule[]): SpellUnlockRule[] {
  const seen = new Set<string>();
  const out: SpellUnlockRule[] = [];
  for (const r of rules) {
    if (!r) continue;
    const k = `${String(r.classId).toLowerCase().trim()}::${String(r.spellId).trim()}::${Number(r.minLevel) || 1}::${r.autoGrant ? 1 : 0}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

type SpellUnlockRuleInput =
  | SpellUnlockRule
  | {
      class_id?: unknown;
      spell_id?: unknown;
      min_level?: unknown;
      auto_grant?: unknown;
      is_enabled?: unknown;
      notes?: unknown;
      // allow camelCase too (tests sometimes pass either)
      classId?: unknown;
      spellId?: unknown;
      minLevel?: unknown;
      autoGrant?: unknown;
      isEnabled?: unknown;
      source?: unknown;
    };

function coerceRuleInput(raw: SpellUnlockRuleInput): SpellUnlockRule | null {
  if (!raw) return null;

  const classId = asStr((raw as any).classId ?? (raw as any).class_id).toLowerCase().trim();
  const spellId = asStr((raw as any).spellId ?? (raw as any).spell_id).trim();

  if (!classId || !spellId) return null;

  const minLevel = Math.max(1, asNum((raw as any).minLevel ?? (raw as any).min_level, 1));
  const autoGrant = asBool((raw as any).autoGrant ?? (raw as any).auto_grant);
  const isEnabled = asBool((raw as any).isEnabled ?? (raw as any).is_enabled);

  const notesRaw = (raw as any).notes ?? (raw as any).source;
  const notes = notesRaw != null ? asStr(notesRaw) : undefined;

  return { classId, spellId, minLevel, autoGrant, isEnabled, notes };
}

function normalizeRuleInputs(inputs: SpellUnlockRuleInput[] | unknown): SpellUnlockRule[] {
  const arr = Array.isArray(inputs) ? (inputs as SpellUnlockRuleInput[]) : [];
  const out: SpellUnlockRule[] = [];
  for (const r of arr) {
    const coerced = coerceRuleInput(r);
    if (coerced) out.push(coerced);
  }
  return out;
}

function buildReferenceKitSpellUnlocks(): SpellUnlockRule[] {
  const out: SpellUnlockRule[] = [];

  // Reference kits are code-defined and stable. We only convert the *spell* entries.
  for (const [classId, entries] of Object.entries(REFERENCE_CLASS_KITS_L1_10)) {
    const list = Array.isArray(entries) ? entries : [];
    for (const e of list as any[]) {
      if (!e || e.kind !== "spell") continue;
      const rule: SpellUnlockRule = {
        classId: String(classId).toLowerCase().trim(),
        spellId: String(e.spellId ?? "").trim(),
        minLevel: Math.max(1, Number(e.minLevel ?? 1) || 1),
        autoGrant: Boolean(e.autoGrant),
        isEnabled: Boolean(e.isEnabled),
        notes: "reference_kit",
      };
      if (!rule.classId || !rule.spellId) continue;
      out.push(rule);
    }
  }

  return uniqRules(out);
}

function getEffectiveRules(): SpellUnlockRule[] {
  // Tests can fully override.
  if (testOverride) return uniqRules([...testOverride]);

  // In contract tests, we always have reference kit spell rules layered in so autogrant works.
  if (process.env.WORLDCORE_TEST === "1") {
    return uniqRules([...unlocks, ...buildReferenceKitSpellUnlocks()]);
  }

  return uniqRules([...unlocks]);
}

export function getSpellUnlockSource(): "code" | "db" | "test" {
  // In WORLDCORE_TEST, even if we didn't call __setSpellUnlocksForTest,
  // we still treat the ruleset as "test" because it's deterministic + code-defined.
  if (process.env.WORLDCORE_TEST === "1") return "test";
  return unlockSource;
}

export function getAllSpellUnlockRules(): SpellUnlockRule[] {
  return [...getEffectiveRules()];
}

export function getAutoGrantUnlocksFor(classId: string, level: number): SpellUnlockRule[] {
  const cid = (classId || "").toLowerCase().trim();
  const lvl = Math.max(1, Number.isFinite(Number(level)) ? Number(level) : 1);

  const rules = getAllSpellUnlockRules()
    .filter((r) => r && r.isEnabled && r.autoGrant)
    .filter((r) => (r.classId || "").toLowerCase().trim() === "any" || (r.classId || "").toLowerCase().trim() === cid)
    .filter((r) => (Number(r.minLevel) || 1) <= lvl)
    .sort((a, b) => a.minLevel - b.minLevel || a.spellId.localeCompare(b.spellId));

  return rules;
}

/**
 * List learnable (non-autoGrant) unlock rules for a given class/level.
 * Used for UI commands like "learn" lists.
 */
export function getLearnableUnlocksFor(classId: string, level: number): SpellUnlockRule[] {
  const cid = (classId || "").toLowerCase().trim();
  const lvl = Math.max(1, Number.isFinite(Number(level)) ? Number(level) : 1);

  const rules = getAllSpellUnlockRules()
    .filter((r) => r && r.isEnabled && !r.autoGrant)
    .filter((r) => (r.classId || "").toLowerCase().trim() === "any" || (r.classId || "").toLowerCase().trim() === cid)
    .filter((r) => (Number(r.minLevel) || 1) <= lvl)
    .sort((a, b) => a.minLevel - b.minLevel || a.spellId.localeCompare(b.spellId));

  return rules;
}

/**
 * Load unlock rules from DB (once).
 *
 * Table: public.spell_unlocks
 * Columns: class_id, spell_id, min_level, auto_grant, is_enabled, notes
 */
export async function initSpellUnlocksFromDbOnce(pool: PgPoolLoose): Promise<void> {
  // In tests, we don't query DB; reference kit rules are code-defined + layered in.
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

      unlocks = uniqRules(loaded);
      unlockSource = "db";

      log.info("Loaded spell unlock rules from DB", {
        count: unlocks.length,
      });
    } catch (err: any) {
      // Missing table: 42P01, others: keep fallback
      const code = String(err?.code ?? "");
      const msg = String(err?.message ?? err);

      const shardMode = String(process.env.PW_SHARD_MODE ?? "").trim().toLowerCase();
      const isLive = shardMode === "live";
      const softLog: any = isLive ? log.warn : (log as any).info ?? (log as any).debug ?? log.warn;

      if (code === "42P01" || /relation .*spell_unlocks.* does not exist/i.test(msg)) {
        softLog("DB spell_unlocks table not found; keeping code fallback unlock list.", {
          code,
          message: msg,
        });
      } else {
        (isLive ? log.warn : softLog)("DB spell_unlocks load failed; keeping code fallback unlock list.", {
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
export function __setSpellUnlocksForTest(rules: SpellUnlockRuleInput[] | unknown): void {
  testOverride = uniqRules(normalizeRuleInputs(rules));
  unlockSource = "test";
}

/**
 * Test helper: clear overrides and restore current unlock set.
 */
export function __resetSpellUnlocksForTest(): void {
  testOverride = null;
  // In tests we still treat it as test because reference kits are layered in.
  if (process.env.WORLDCORE_TEST === "1") {
    unlockSource = "test";
  }
}
