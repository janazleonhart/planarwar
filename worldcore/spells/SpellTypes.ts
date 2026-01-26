// worldcore/spells/SpellTypes.ts

import type { Pool } from "pg";
import type { SpellSchoolId, DamageSchool } from "../combat/CombatEngine";
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
  | "heal_hot_self"
  | "heal_hot_single_ally"
  | "shield_self"
  | "shield_single_ally"
  | "cleanse_self"
  | "cleanse_single_ally"
  | "buff_self"
  | "buff_single_ally"
  | "debuff_single_npc"
  // Back-compat alias: some earlier WIP code used this shorter kind.
  | "dot_single_npc"
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

  /** Optional HOT metadata (used when spell.kind starts with 'heal_hot_'). */
  hot?: {
    /** Tick interval in milliseconds. */
    tickIntervalMs?: number;
    /** Heal per tick. */
    perTickHeal?: number;
  };

  /** Optional absorb/shield metadata (used when spell.kind starts with 'shield_'). */
  absorb?: {
    /** Total amount of damage this shield can absorb. */
    amount?: number;
    /** Restrict absorption to these schools; omit to absorb any. */
    schools?: DamageSchool[];
  };
}


export interface SpellCleanse {
  tags: string[];
  maxToRemove?: number;
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

  // Legacy top-level fields (older spell defs/tests).
  // Prefer using `statusEffect` payloads long-term.
  absorbAmount?: number;
  dotTickMs?: number;
  dotFlatDamage?: number;
  dotMaxTicks?: number;

  // Songs
  isSong?: boolean;
  songSchool?: SongSchoolId;

  // Cleanse/dispel spells
  cleanse?: SpellCleanse;

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
  // System 5.4 reference-kit spells (L1–10)
  // These live in the in-code fallback so WORLDCORE_TEST can validate autogrants
  // without requiring DB access.
  // ─────────────────────────────────────────────────────────────────────────────

  // Archmage kit
  archmage_arcane_bolt: {
    id: "archmage_arcane_bolt",
    name: "Arcane Bolt",
    kind: "damage_single_npc",
    classId: "archmage",
    minLevel: 1,
    description: "A focused bolt of arcane force—clean, efficient, and slightly smug.",
    school: "arcane",
    resourceType: "mana",
    resourceCost: 10,
    cooldownMs: 2500,
    damageMultiplier: 1.05,
    flatBonus: 10,
  },

  archmage_expose_arcana: {
    id: "archmage_expose_arcana",
    name: "Expose Arcana",
    kind: "debuff_single_npc",
    classId: "archmage",
    minLevel: 3,
    description: "Reveals unstable ley-lines on the target, priming them for increased punishment.",
    school: "arcane",
    resourceType: "mana",
    resourceCost: 14,
    cooldownMs: 12000,
  },

  archmage_mana_shield: {
    id: "archmage_mana_shield",
    name: "Mana Shield",
    kind: "shield_self",
    classId: "archmage",
    minLevel: 5,
    description: "Wrap yourself in a thin lattice of mana that absorbs incoming damage.",
    school: "arcane",
    resourceType: "mana",
    resourceCost: 22,
    cooldownMs: 20000,
    absorbAmount: 60,
  },

  archmage_ignite: {
    id: "archmage_ignite",
    name: "Ignite",
    kind: "damage_dot_single_npc",
    classId: "archmage",
    minLevel: 7,
    description: "Sets the target alight, dealing damage over time.",
    school: "fire",
    resourceType: "mana",
    resourceCost: 18,
    cooldownMs: 8000,
    dotTickMs: 2000,
    dotFlatDamage: 6,
    dotMaxTicks: 5,
  },

  archmage_purge_hex: {
    id: "archmage_purge_hex",
    name: "Purge Hex",
    kind: "cleanse_self",
    classId: "archmage",
    minLevel: 9,
    description: "Scrubs hostile enchantments from your aura.",
    school: "arcane",
    resourceType: "mana",
    resourceCost: 20,
    cooldownMs: 15000,
    cleanse: { tags: ["hex", "curse", "poison"], maxToRemove: 1 },
  },

  // Warlock kit
  warlock_void_bolt: {
    id: "warlock_void_bolt",
    name: "Void Bolt",
    kind: "damage_single_npc",
    classId: "warlock",
    minLevel: 1,
    description: "A bolt of void energy that bites deeper than it looks.",
    school: "shadow",
    resourceType: "mana",
    resourceCost: 12,
    cooldownMs: 2500,
    damageMultiplier: 1.08,
    flatBonus: 10,
  },

  warlock_fear: {
    id: "warlock_fear",
    name: "Fear",
    kind: "debuff_single_npc",
    classId: "warlock",
    minLevel: 5,
    description: "Cripples the target with dread, lowering their will to fight.",
    school: "shadow",
    resourceType: "mana",
    resourceCost: 18,
    cooldownMs: 18000,
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


// --- DB normalization helpers (keep permissive; DB JSON can evolve) ---

function asSchoolId(v: any): SpellSchoolId | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? (s as SpellSchoolId) : undefined;
}

function asPowerResourceKind(v: any): PowerResourceKind | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? (s as PowerResourceKind) : undefined;
}

function asStringArray(v: any): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  return undefined;
}

function asNumber(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeStatusEffect(raw: any): SpellStatusEffect | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const asStr = (v: any, d = ""): string => (typeof v === "string" ? v : d);
  const asNum = (v: any, d = 0): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const asBool = (v: any, d = false): boolean => (typeof v === "boolean" ? v : d);

  // Normalize optional nested blocks (dot/hot/absorb) with camelCase + snake_case support.
  const normDot = (v: any) => {
    if (!v || typeof v !== "object") return undefined;
    const tickIntervalMs = asNum(v.tickIntervalMs ?? v.tick_interval_ms ?? v.tickMs ?? v.tick_ms, 0);
    const spreadDamageAcrossTicks = asBool(
      v.spreadDamageAcrossTicks ?? v.spread_damage_across_ticks,
      false
    );
    const out: any = {};
    if (tickIntervalMs > 0) out.tickIntervalMs = tickIntervalMs;
    out.spreadDamageAcrossTicks = spreadDamageAcrossTicks;
    return Object.keys(out).length ? out : undefined;
  };

  const normHot = (v: any) => {
    if (!v || typeof v !== "object") return undefined;
    const tickIntervalMs = asNum(v.tickIntervalMs ?? v.tick_interval_ms ?? v.tickMs ?? v.tick_ms, 0);
    const healPerTick = asNum(
      v.healPerTick ?? v.heal_per_tick ?? v.tickHealAmount ?? v.tick_heal_amount,
      0
    );
    const out: any = {};
    if (tickIntervalMs > 0) out.tickIntervalMs = tickIntervalMs;
    if (healPerTick != 0) out.healPerTick = healPerTick;
    return Object.keys(out).length ? out : undefined;
  };

  const normAbsorb = (v: any) => {
    if (!v || typeof v !== "object") return undefined;
    const amount = asNum(v.amount ?? v.absorbAmount ?? v.absorb_amount, 0);
    const out: any = {};
    if (amount != 0) out.amount = amount;
    return Object.keys(out).length ? out : undefined;
  };

  const out: any = {};

  out.id = asStr(raw.id).trim();
  const _name = asStr(raw.name).trim();
  if (_name) out.name = _name;
  out.durationMs = asNum(raw.durationMs ?? raw.duration_ms, 0);
  out.tags = Array.isArray(raw.tags) ? raw.tags.map((t: any) => String(t)) : [];

  const dot = normDot(raw.dot);
  if (dot) out.dot = dot;

  const hot = normHot(raw.hot);
  if (hot) out.hot = hot;

  const absorb = normAbsorb(raw.absorb);
  if (absorb) out.absorb = absorb;

  // Modifiers (nested object + a few legacy flat fields)
  const modsRaw = raw.modifiers && typeof raw.modifiers === "object" ? raw.modifiers : {};
  const dmgTakenPct = modsRaw.damageTakenPct ?? modsRaw.damage_taken_pct ?? raw.damageTakenPct ?? raw.damage_taken_pct;
  const dmgDealtPct = modsRaw.damageDealtPct ?? modsRaw.damage_dealt_pct ?? raw.damageDealtPct ?? raw.damage_dealt_pct;
  const mods: any = {};
  if (dmgTakenPct !== undefined) mods.damageTakenPct = asNum(dmgTakenPct, 0);
  if (dmgDealtPct !== undefined) mods.damageDealtPct = asNum(dmgDealtPct, 0);
  out.modifiers = Object.keys(mods).length ? mods : {};

  // Stacking controls
  const maxStacks = raw.maxStacks ?? raw.max_stacks;
  if (maxStacks !== undefined) out.maxStacks = asNum(maxStacks, 0);

  const stackingPolicy = asStr(raw.stackingPolicy ?? raw.stacking_policy, "");
  if (stackingPolicy) out.stackingPolicy = stackingPolicy;

  const stackingGroupId = asStr(raw.stackingGroupId ?? raw.stacking_group_id, "");
  if (stackingGroupId) out.stackingGroupId = stackingGroupId;


  if (!out.id || out.durationMs <= 0) return undefined;
  return out as SpellStatusEffect;
}

function normalizeCleanse(raw: any): SpellCleanse | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const tags = asStringArray(raw.tags) ?? asStringArray(raw.removeTags) ?? asStringArray(raw.remove_tags);
  if (!tags || tags.length === 0) return undefined;

  const out: SpellCleanse = { tags };
  const maxToRemove = raw.maxToRemove ?? raw.max_to_remove ?? raw.max;
  const n = asNumber(maxToRemove);
  if (n !== undefined) (out as any).maxToRemove = n;
  return out;
}

function mapDbRowToSpellDef(row: DbSpellRow): SpellDefinition {
  const k = String(row.kind ?? "").trim();
  const def: SpellDefinition = {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    kind: (k ? (k as SpellKind) : "damage_single_npc"),
    classId: row.class_id ? String(row.class_id) : "any",
    minLevel: Math.max(1, Number(row.min_level ?? 1)),
  };

  const school = asSchoolId(row.school);
  if (school) def.school = school;

  if (row.damage_multiplier != null) def.damageMultiplier = Number(row.damage_multiplier);
  if (row.flat_bonus != null) def.flatBonus = Number(row.flat_bonus);
  if (row.heal_amount != null) def.healAmount = Number(row.heal_amount);

  const resourceType = asPowerResourceKind(row.resource_type);
  if (resourceType) def.resourceType = resourceType;
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

  // Optional DB-driven extras
  const se = normalizeStatusEffect((row as any).status_effect ?? (row as any).statusEffect);
  if (se) def.statusEffect = se;

  const cleanse = normalizeCleanse((row as any).cleanse);
  if (cleanse) def.cleanse = cleanse;

  if (row.is_debug || (row as any).is_dev_only) def.isDebug = true;

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

// test seam
export function __mapDbRowToSpellDefForTest(row: DbSpellRow): SpellDefinition {
  return mapDbRowToSpellDef(row);
}
