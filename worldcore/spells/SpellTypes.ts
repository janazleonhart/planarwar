// worldcore/spells/SpellTypes.ts

import type { Pool } from "pg";
import type { SpellSchoolId } from "../combat/CombatEngine";
import type { SongSchoolId } from "../skills/SkillProgression";
import type { PowerResourceKind } from "../resources/PowerResources";
import { Logger } from "../utils/logger";
import { loadSpellCatalogFromDb, type DbSpellRow } from "./SpellCatalog";
import { getAutoGrantUnlocksFor, initSpellUnlocksFromDbOnce } from "./SpellUnlocks";
import type { StatusEffectModifier } from "../combat/StatusEffects";
import type { StatusStackingPolicy } from "../combat/StatusStackingPolicy";

const log = Logger.scope("SPELLS");

export type SpellKind =
  | "damage_single_npc"
  | "heal_self"
  | "heal_single_ally"
  | "buff_self"
  | "buff_single_ally"
  | "debuff_single_npc"
  | "damage_dot_single_npc";

const SONG_SCHOOL_IDS = ["voice", "strings", "winds", "percussion", "brass"] as const;

function asSongSchoolId(v: unknown): SongSchoolId | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (SONG_SCHOOL_IDS as readonly string[]).includes(s) ? (s as SongSchoolId) : undefined;
}


export interface SpellStatusEffect {
  /** Stable id for the status effect instance (used for stacking/refreshing). */
  id: string;
  /** Display name shown to the player. Defaults to the spell name if omitted. */
  name?: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Max stacks for the effect. Defaults to 1. */
  maxStacks?: number;
  /** Stacks applied per cast. Defaults to 1. */
  stacks?: number;
  /**
   * Stacking policy for this status effect.
   *
   * Default is legacy behavior (single instance per id, stacks add). To enable
   * the "different versions stack if different applier" gameplay, use:
   *   stackingPolicy: "versioned_by_applier"
   */
  stackingPolicy?: StatusStackingPolicy;

  /**
   * Optional stacking group id. If set, effects sharing the same group are
   * stacked together. If omitted, the status effect id is used.
   */
  stackingGroupId?: string;
  /** Stat/combat modifiers applied while the effect is active. */
  modifiers: StatusEffectModifier;
  /** Optional tags for UI / filtering. */
  tags?: string[];

  /** Optional DOT metadata (used when spell.kind === "damage_dot_single_npc"). */
  dot?: {
    /** Tick interval in milliseconds (default: 2000ms). */
    tickIntervalMs?: number;
    /** If true (default), total damage is distributed across ticks. */
    spreadDamageAcrossTicks?: boolean;
  };
}

export interface SpellDefinition {
  id: string;
  name: string;
  kind: SpellKind;

  /** A simple class gate. Use "any" for universal spells. */
  classId: string;

  minLevel: number;
  description: string;

  // Combat metadata
  school?: SpellSchoolId;
  damageMultiplier?: number;
  flatBonus?: number;
  healAmount?: number;
  // For buff/debuff/DOT spells: apply a status effect on cast.
  statusEffect?: SpellStatusEffect;

  // Resource + cooldown
  resourceType?: PowerResourceKind;
  resourceCost?: number;
  cooldownMs?: number;

  // Songs
  isSong?: boolean;
  songSchool?: SongSchoolId;

  // Misc
  isDebug?: boolean;
}

/**
 * Canonical in-code spell map (fallback + tests).
 *
 * During transition, we *mutate* this object in-place when DB catalog loads:
 * - DB spell definitions upsert into SPELLS by id (overwriting code defaults)
 * - alias ids are installed as NON-enumerable getters onto SPELLS
 *
 * This means existing imports that do SPELLS[id] will keep working even after DB-load,
 * without forcing a repo-wide refactor right away.
 */
export const SPELLS: Record<string, SpellDefinition> = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Universal starter spell
  // ─────────────────────────────────────────────────────────────────────────────
  arcane_bolt: {
    id: "arcane_bolt",
    name: "Arcane Bolt",
    kind: "damage_single_npc",
    classId: "any",
    minLevel: 1,
    description: "A simple bolt of arcane energy. Reliable, if not subtle.",
    school: "arcane",
    resourceType: "mana",
    resourceCost: 8,
    cooldownMs: 2500,
    damageMultiplier: 1.0,
    flatBonus: 8,
  },

  // Dev-only spell kept for quick troubleshooting / combat debugging.
  debug_arcane_bolt: {
    id: "debug_arcane_bolt",
    name: "Debug Arcane Bolt",
    kind: "damage_single_npc",
    classId: "any",
    minLevel: 1,
    description: "Developer testing spell. Cheap, strong, and intentionally boring.",
    school: "arcane",
    resourceType: "mana",
    resourceCost: 0,
    cooldownMs: 0,
    damageMultiplier: 1.0,
    flatBonus: 20,
    isDebug: true,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Class spells
  // ─────────────────────────────────────────────────────────────────────────────
  mage_fire_bolt: {
    id: "mage_fire_bolt",
    name: "Fire Bolt",
    kind: "damage_single_npc",
    classId: "mage",
    minLevel: 1,
    description: "A bolt of flame that scorches a single target.",
    school: "fire",
    resourceType: "mana",
    resourceCost: 15,
    cooldownMs: 2500,
    damageMultiplier: 1.15,
    flatBonus: 12,
  },

  cleric_minor_heal: {
    id: "cleric_minor_heal",
    name: "Minor Heal",
    kind: "heal_self",
    classId: "cleric",
    minLevel: 1,
    description: "Restore a modest amount of health to yourself.",
    school: "holy",
    resourceType: "mana",
    resourceCost: 18,
    cooldownMs: 8000,
    healAmount: 40,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Virtuoso songs
  // ─────────────────────────────────────────────────────────────────────────────
  virtuoso_song_rising_courage: {
    id: "virtuoso_song_rising_courage",
    name: "Song of Rising Courage",
    kind: "heal_self",
    classId: "virtuoso",
    minLevel: 1,
    description: "A steady melody that bolsters courage and mends small wounds.",
    isSong: true,
    songSchool: "voice",
    resourceType: "mana",
    resourceCost: 12,
    cooldownMs: 4000,
    healAmount: 20,
  },

  virtuoso_hymn_woven_recovery: {
    id: "virtuoso_hymn_woven_recovery",
    name: "Hymn of Woven Recovery",
    kind: "heal_self",
    classId: "virtuoso",
    minLevel: 3,
    description: "A restorative hymn that stitches vitality back into place.",
    isSong: true,
    songSchool: "voice",
    resourceType: "mana",
    resourceCost: 18,
    cooldownMs: 8000,
    healAmount: 30,
  },

  // Canonical id expected by tests + historical handoffs
  virtuoso_dissonant_battle_chant: {
    id: "virtuoso_dissonant_battle_chant",
    name: "Dissonant Battle Chant",
    kind: "damage_single_npc",
    classId: "virtuoso",
    minLevel: 5,
    description: "A discordant chant that rattles a foe and builds momentum.",
    isSong: true,
    songSchool: "voice",
    resourceType: "mana",
    resourceCost: 15,
    cooldownMs: 4000,
    damageMultiplier: 1.05,
    flatBonus: 8,
  },
};

/**
 * Alias map (alias id -> canonical id).
 * Installed aliases are also mirrored as NON-enumerable getters on SPELLS.
 */
export const SPELL_ALIASES: Record<string, string> = {
  // Keep legacy alias stable in code too (DB can override / extend this).
  song_virtuoso_battle_chant: "virtuoso_dissonant_battle_chant",
};

let installedAliasKeys = new Set<string>();

export function resolveSpellId(id: string): string {
  const k = String(id ?? "").trim();
  if (!k) return "";
  return SPELL_ALIASES[k] ?? k;
}

export function getSpellByIdOrAlias(id: string): SpellDefinition | undefined {
  const resolved = resolveSpellId(id);
  if (!resolved) return undefined;
  return SPELLS[resolved];
}

function installAliasGettersOnSpells(): void {
  // Remove old alias getters first (if reloading)
  for (const k of installedAliasKeys) {
    try {
      delete (SPELLS as any)[k];
    } catch {
      // ignore
    }
  }
  installedAliasKeys = new Set<string>();

  for (const [aliasId, canonicalId] of Object.entries(SPELL_ALIASES)) {
    if (!aliasId || !canonicalId) continue;

    Object.defineProperty(SPELLS, aliasId, {
      configurable: true,
      enumerable: false,
      get: () => SPELLS[canonicalId],
    });

    installedAliasKeys.add(aliasId);
  }
}

// Install code aliases immediately
installAliasGettersOnSpells();

// ─────────────────────────────────────────────────────────────────────────────
// Spellbook / known spells state (still stored on CharacterState for now)
// ─────────────────────────────────────────────────────────────────────────────

export type SpellKnownEntry = {
  learnedAtLevel: number;
  learnedAtMs: number;
  source: "auto" | "manual";
};

export type SpellbookKnownMap = Record<string, SpellKnownEntry | true>;

export type SpellbookStateLike = {
  known: SpellbookKnownMap;
  autoGrantedThroughLevel?: number;
};

export type SpellbookCharLike = {
  classId?: string;
  level?: number;
  spellbook?: any;
};

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function getSafeLevel(char: SpellbookCharLike): number {
  const n = Number(char.level ?? 1);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
}

function matchesClass(spellClassId: string, charClassId: string): boolean {
  const sc = norm(spellClassId);
  if (sc === "any") return true;
  const cc = norm(charClassId);
  if (!cc) return false;
  return cc === sc;
}

function ensureKnownMap(sb: any): SpellbookKnownMap {
  if (!sb.known || typeof sb.known !== "object") sb.known = {};
  return sb.known as SpellbookKnownMap;
}

/**
 * Ensures a spellbook-like object exists on the character.
 * This is intentionally tolerant of older saved shapes.
 */
export function ensureSpellbook(char: SpellbookCharLike): SpellbookStateLike {
  let sb: any = (char as any).spellbook;
  if (!sb || typeof sb !== "object") {
    sb = { known: {}, autoGrantedThroughLevel: 0 };
    (char as any).spellbook = sb;
  } else {
    ensureKnownMap(sb);
  }
  return sb as SpellbookStateLike;
}

/**
 * MVP spell acquisition: auto-grant all spells that match class ("any" or exact classId)
 * and are <= the character's current level.
 */
export function ensureSpellbookAutogrants(
  char: SpellbookCharLike,
  nowMs: number = Date.now(),
): SpellbookStateLike {
  const sb: any = ensureSpellbook(char);
  const known = ensureKnownMap(sb);

  // Compatibility migration: normalize known map keys if an alias was stored.
  for (const [aliasId, canonicalId] of Object.entries(SPELL_ALIASES)) {
    if (known[aliasId] && !known[canonicalId]) {
      known[canonicalId] = known[aliasId];
      delete known[aliasId];
    }
  }

  const charClass = norm(char.classId);
  const level = getSafeLevel(char);

    // DB-driven unlock rules (with safe code fallback).
  // This prevents "every spell definition becomes auto-granted forever" once the catalog grows.
  const unlocks = getAutoGrantUnlocksFor(charClass, level);

  for (const u of unlocks) {
    const canonicalId = (SPELL_ALIASES as any)[u.spellId] || u.spellId;
    const spell = (SPELLS as any)[canonicalId] as SpellDefinition | undefined;
    if (!spell) continue;
    if (spell.isDebug) continue;

    if (!known[spell.id]) {
      known[spell.id] = {
        learnedAtLevel: u.minLevel || spell.minLevel,
        learnedAtMs: nowMs,
        source: "auto",
      };
    }
  }

  const prev = Number(sb.autoGrantedThroughLevel ?? 0);
  if (!Number.isFinite(prev) || prev < level) sb.autoGrantedThroughLevel = level;

  return sb as SpellbookStateLike;
}

export function isSpellKnownForChar(char: SpellbookCharLike, spellId: string): boolean {
  const sb: any = ensureSpellbookAutogrants(char);
  const known = ensureKnownMap(sb);

  const resolved = resolveSpellId(spellId);
  if (known[resolved]) return true;

  // Treat legacy alias as equivalent if it somehow slips through.
  for (const [aliasId, canonicalId] of Object.entries(SPELL_ALIASES)) {
    if (resolved === aliasId) return !!known[canonicalId];
    if (resolved === canonicalId) return !!known[aliasId];
  }

  return false;
}

export function getKnownSpellsForChar(
  char: SpellbookCharLike,
  opts: { kind: "spells" | "songs" | "all"; includeDebug?: boolean },
): SpellDefinition[] {
  const sb: any = ensureSpellbookAutogrants(char);
  const known = ensureKnownMap(sb);

  const out: SpellDefinition[] = [];
  for (const rawId of Object.keys(known)) {
    const def = getSpellByIdOrAlias(rawId);
    if (!def) continue;

    if (!opts.includeDebug && def.isDebug) continue;

    const isSong = def.isSong === true;
    if (opts.kind === "songs" && !isSong) continue;
    if (opts.kind === "spells" && isSong) continue;

    out.push(def);
  }

  // De-dupe by canonical spell id
  const seen = new Set<string>();
  const deduped: SpellDefinition[] = [];
  for (const def of out) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    deduped.push(def);
  }

  deduped.sort((a, b) => {
    if (a.minLevel !== b.minLevel) return a.minLevel - b.minLevel;
    return a.name.localeCompare(b.name);
  });

  return deduped;
}

function pickBestSpell(candidates: SpellDefinition[], q: string): SpellDefinition {
  const query = norm(q);
  return [...candidates].sort((a, b) => {
    const aIdExact = norm(a.id) === query ? 0 : 1;
    const bIdExact = norm(b.id) === query ? 0 : 1;
    if (aIdExact !== bIdExact) return aIdExact - bIdExact;

    const aNameExact = norm(a.name) === query ? 0 : 1;
    const bNameExact = norm(b.name) === query ? 0 : 1;
    if (aNameExact !== bNameExact) return aNameExact - bNameExact;

    const aDbg = a.isDebug ? 1 : 0;
    const bDbg = b.isDebug ? 1 : 0;
    if (aDbg !== bDbg) return aDbg - bDbg;

    if (a.minLevel !== b.minLevel) return a.minLevel - b.minLevel;

    if (a.name.length !== b.name.length) return a.name.length - b.name.length;

    return a.name.localeCompare(b.name);
  })[0];
}

export function findSpellByNameOrId(raw: string): SpellDefinition | null {
  const q = norm(raw);
  if (!q) return null;

  const direct = getSpellByIdOrAlias(q);
  if (direct) return direct;

  const all = Object.values(SPELLS);

  // exact id or name match
  const exact = all.filter((s) => norm(s.id) === q || norm(s.name) === q);
  if (exact.length > 0) return pickBestSpell(exact, q);

  // partial match (id or name contains)
  const partial = all.filter((s) => norm(s.id).includes(q) || norm(s.name).includes(q));
  if (partial.length > 0) return pickBestSpell(partial, q);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB integration (definitions only) — safe, additive, and test-friendly.
// ─────────────────────────────────────────────────────────────────────────────

let dbInitPromise: Promise<void> | null = null;

function mapDbRowToSpellDef(row: DbSpellRow): SpellDefinition {
  const def: SpellDefinition = {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    kind: (row.kind === "heal_self" || row.kind === "damage_single_npc"
      ? row.kind
      : "damage_single_npc") as SpellKind,
    classId: row.class_id || "any",
    minLevel: Math.max(1, Number(row.min_level ?? 1)),
  };

  if (row.school) def.school = row.school as any;
  if (row.damage_multiplier != null) def.damageMultiplier = Number(row.damage_multiplier);
  if (row.flat_bonus != null) def.flatBonus = Number(row.flat_bonus);
  if (row.heal_amount != null) def.healAmount = Number(row.heal_amount);

  if (row.resource_type) def.resourceType = row.resource_type as any;
  def.resourceCost = Number(row.resource_cost ?? 0);
  def.cooldownMs = Number(row.cooldown_ms ?? 0);

  if (row.is_song) def.isSong = true;
  if (row.song_school) {
    const ss = asSongSchoolId(row.song_school);
    if (ss) def.songSchool = ss;
    else log.warn("Unknown song_school value in DB spell row; ignoring", {
      spellId: row.id,
      songSchool: row.song_school,
    });
  }

  if (row.is_debug || row.is_dev_only) def.isDebug = true;

  return def;
}

export async function initSpellsFromDbOnce(pool: Pool): Promise<void> {
  if (process.env.WORLDCORE_TEST === "1") return;

  if (dbInitPromise) return dbInitPromise;
  dbInitPromise = (async () => {
    try {
      const { defsById, aliases } = await loadSpellCatalogFromDb(pool, mapDbRowToSpellDef);

      const loadedIds = Object.keys(defsById);
      if (loadedIds.length === 0) {
        log.warn("DB spell catalog returned 0 rows; keeping code-defined SPELLS map.");
      } else {
        for (const [id, def] of Object.entries(defsById)) {
          SPELLS[id] = def;
        }
        log.info("DB spell catalog loaded", { spellsLoaded: loadedIds.length });
      }

      for (const [aliasId, canonicalId] of Object.entries(aliases)) {
        SPELL_ALIASES[aliasId] = canonicalId;
      }

      installAliasGettersOnSpells();
      log.info("DB spell aliases loaded", { aliasesLoaded: Object.keys(aliases).length });
    } catch (err: any) {
      const code = String(err?.code ?? "");
      if (code === "42P01" || String(err?.message ?? "").includes("does not exist")) {
        log.warn("DB spell catalog tables not found yet; keeping code-defined SPELLS map.", {
          code,
          message: String(err?.message ?? err),
        });
      } else {
        log.warn("DB spell catalog load failed; keeping code-defined SPELLS map.", {
          code,
          message: String(err?.message ?? err),
        });
      }
    }
  })();

  // Best-effort: also load spell unlock rules from DB. If missing, we keep code fallback.
  try {
    await initSpellUnlocksFromDbOnce(pool as any);
  } catch {
    // ignored; SpellUnlocks module already defaults safely
  }

  return dbInitPromise;
}