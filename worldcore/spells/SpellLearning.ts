// worldcore/spells/SpellLearning.ts
//
// Pure helpers for:
// - determining whether a spell/song is learnable
// - applying a "learn spell" mutation to CharacterState (in-memory)
//
// Persistence happens elsewhere (e.g., PostgresCharacterService.learnSpellWithRules()).
//
// Policy:
// - When SpellUnlocks source is "db" or "test": require an enabled unlock rule for the spell.
// - When source is "code": allow learning any catalog-known spell (dev-friendly / backward-compatible),
//   because the code fallback unlock list is intentionally tiny.

import type { CharacterState, SpellbookState } from "../characters/CharacterTypes";
import type { SpellDefinition } from "./SpellTypes";

import { SPELLS, getSpellByIdOrAlias, resolveSpellId, isSpellKnownForChar, ensureSpellbookAutogrants } from "./SpellTypes";
import { getSpellUnlockSource, getAllSpellUnlockRules, getLearnableUnlocksFor, type SpellUnlockRule } from "./SpellUnlocks";

function safeNow(nowMs?: number): number {
  const n = Number(nowMs);
  return Number.isFinite(n) ? n : Date.now();
}

function getSafeLevel(char: any): number {
  const n = Number(char?.level);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function getSafeClassId(char: any): string {
  return String(char?.classId ?? "").toLowerCase().trim();
}

export type LearnSpellResult =
  | { ok: true; next: CharacterState; spell: SpellDefinition; canonicalId: string }
  | {
      ok: false;
      error:
        | "unknown_spell"
        | "not_learnable"
        | "level_too_low"
        | "requires_trainer"
        | "requires_grant";
      requiredRule?: SpellUnlockRule;
    };

export type LearnSpellOpts = {
  /** If true, bypass trainer requirement (used by explicit trainer flow). */
  viaTrainer?: boolean;
  /** Debug/dev bypass for content-grant requirements. */
  bypassGrant?: boolean;
};

function ensureSpellbookPending(sb: any): void {
  if (!sb) return;
  if (!sb.pending || typeof sb.pending !== "object") sb.pending = {};
}

export function listPendingSpellsForChar(char: CharacterState): string[] {
  const sb = ensureSpellbookAutogrants(char as any) as any;
  ensureSpellbookPending(sb);
  return Object.keys(sb.pending ?? {}).sort();
}

export function grantSpellInState(
  char: CharacterState,
  spellIdRaw: string,
  source?: string,
  nowMs?: number,
): { ok: true; next: CharacterState } | { ok: false; error: "unknown_spell" } {
  const canonicalId = resolveSpellId(String(spellIdRaw ?? "").trim());
  if (!canonicalId) return { ok: false, error: "unknown_spell" };

  const def = getSpellByIdOrAlias(canonicalId) as SpellDefinition | undefined;
  if (!def) return { ok: false, error: "unknown_spell" };

  const sb = ensureSpellbookAutogrants(char as any) as any;
  ensureSpellbookPending(sb);

  const pending = { ...(sb.pending ?? {}) };
  if (!pending[canonicalId]) {
    pending[canonicalId] = { grantedAt: safeNow(nowMs), source };
  }

  const next: CharacterState = {
    ...char,
    spellbook: {
      ...(sb as any),
      pending,
    },
  } as any;

  return { ok: true, next };
}

function findEnabledRuleForSpell(canonicalId: string, classId: string): SpellUnlockRule | null {
  const cid = (classId || "").toLowerCase().trim();
  const rules = getAllSpellUnlockRules().filter((r) => r && r.isEnabled);
  return (
    rules.find((r) => r.spellId === canonicalId && (String(r.classId).toLowerCase().trim() === "any" || String(r.classId).toLowerCase().trim() === cid)) ||
    null
  );
}

export function canLearnSpellForChar(
  char: CharacterState,
  spellIdRaw: string,
  opts?: LearnSpellOpts,
): LearnSpellResult {
  const canonicalId = resolveSpellId(String(spellIdRaw ?? "").trim());
  if (!canonicalId) return { ok: false, error: "unknown_spell" };

  const def = getSpellByIdOrAlias(canonicalId) as SpellDefinition | undefined;
  if (!def) return { ok: false, error: "unknown_spell" };

  const requiresTrainer = !!(def as any).learnRequiresTrainer || Number((def as any).rank ?? 1) > 1;
  if (requiresTrainer && !opts?.viaTrainer) return { ok: false, error: "requires_trainer" };

  const requiresGrant = Number((def as any).rank ?? 1) > 1;
  if (requiresGrant && !opts?.bypassGrant) {
    const sb = ensureSpellbookAutogrants(char as any) as any;
    ensureSpellbookPending(sb);
    if (!(sb.pending && (sb.pending as any)[canonicalId])) {
      return { ok: false, error: "requires_grant" };
    }
  }

  // Already known (including auto-grants) => ok/idempotent.
  if (isSpellKnownForChar(char as any, canonicalId)) {
    return { ok: true, next: char, spell: def, canonicalId };
  }

  const source = getSpellUnlockSource();
  const lvl = getSafeLevel(char);
  const cls = getSafeClassId(char);

  if (source === "db" || source === "test") {
    const rule = findEnabledRuleForSpell(canonicalId, cls);
    if (!rule) return { ok: false, error: "not_learnable" };
    if (lvl < Number(rule.minLevel ?? 1)) return { ok: false, error: "level_too_low", requiredRule: rule };
    return { ok: true, next: char, spell: def, canonicalId };
  }

  // Code fallback: allow learning any spell that's in the catalog.
  return { ok: true, next: char, spell: def, canonicalId };
}

export function learnSpellInState(
  char: CharacterState,
  spellIdRaw: string,
  rank = 1,
  nowMs?: number,
  opts?: LearnSpellOpts,
): LearnSpellResult {
  const check = canLearnSpellForChar(char, spellIdRaw, opts);
  if (!check.ok) return check;

  const canonicalId = check.canonicalId;

  // Ensure spellbook exists & auto-grants applied (so we don't accidentally "unlearn" via overwrite).
  const sb = ensureSpellbookAutogrants(char as any) as any;
  ensureSpellbookPending(sb);

  const known = { ...(sb.known ?? {}) };

  // Rank v0: keep only the highest known rank per rankGroupId.
  // If the learned spell belongs to a group, drop lower-rank siblings.
  {
    const def: any = (SPELLS as any)[canonicalId];
    const gid = String(def?.rankGroupId ?? canonicalId).trim().toLowerCase();
    const learnedRank = Number(def?.rank ?? 1);
    if (gid) {
      for (const existingId of Object.keys(known)) {
        if (existingId === canonicalId) continue;
        const eDef: any = (SPELLS as any)[existingId];
        const eGid = String(eDef?.rankGroupId ?? existingId).trim().toLowerCase();
        if (!eGid || eGid !== gid) continue;
        const eRank = Number(eDef?.rank ?? 1);
        // If an equal or higher rank is already known, learning this is a no-op.
        if (eRank >= learnedRank) {
          // ensure we don't insert the lower rank
          return { ok: true, next: char, spell: check.spell, canonicalId: existingId };
        }
        // Otherwise, remove lower rank sibling.
        delete (known as any)[existingId];
      }
    }
  }
  if (!known[canonicalId]) {
    known[canonicalId] = {
      rank,
      learnedAt: safeNow(nowMs),
    };
  }

  const nextSpellbook: SpellbookState = {
    ...(sb as any),
    known,
    pending: {
      ...(sb.pending ?? {}),
    },
  } as any;

  // Consume grant if present.
  if ((nextSpellbook as any).pending && (nextSpellbook as any).pending[canonicalId]) {
    const p = { ...(nextSpellbook as any).pending };
    delete p[canonicalId];
    (nextSpellbook as any).pending = p;
  }

  const next: CharacterState = {
    ...char,
    spellbook: nextSpellbook,
  } as any;

  return { ok: true, next, spell: check.spell, canonicalId };
}

/**
 * Convenience: list learnable (non-autoGrant) rules for the character.
 * (Requires SpellUnlocks source to be db/test to be authoritative.)
 */
export function listLearnableSpellsForChar(char: CharacterState): SpellUnlockRule[] {
  const cls = getSafeClassId(char);
  const lvl = getSafeLevel(char);
  return getLearnableUnlocksFor(cls, lvl);
}
