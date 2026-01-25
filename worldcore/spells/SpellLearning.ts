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
  | { ok: false; error: "unknown_spell" | "not_learnable" | "level_too_low"; requiredRule?: SpellUnlockRule };

function findEnabledRuleForSpell(canonicalId: string, classId: string): SpellUnlockRule | null {
  const cid = (classId || "").toLowerCase().trim();
  const rules = getAllSpellUnlockRules().filter((r) => r && r.isEnabled);
  return (
    rules.find((r) => r.spellId === canonicalId && (String(r.classId).toLowerCase().trim() === "any" || String(r.classId).toLowerCase().trim() === cid)) ||
    null
  );
}

export function canLearnSpellForChar(char: CharacterState, spellIdRaw: string): LearnSpellResult {
  const canonicalId = resolveSpellId(String(spellIdRaw ?? "").trim());
  if (!canonicalId) return { ok: false, error: "unknown_spell" };

  const def = getSpellByIdOrAlias(canonicalId) as SpellDefinition | undefined;
  if (!def) return { ok: false, error: "unknown_spell" };

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
): LearnSpellResult {
  const check = canLearnSpellForChar(char, spellIdRaw);
  if (!check.ok) return check;

  const canonicalId = check.canonicalId;

  // Ensure spellbook exists & auto-grants applied (so we don't accidentally "unlearn" via overwrite).
  const sb = ensureSpellbookAutogrants(char as any) as any;

  const known = { ...(sb.known ?? {}) };
  if (!known[canonicalId]) {
    known[canonicalId] = {
      rank,
      learnedAt: safeNow(nowMs),
    };
  }

  const nextSpellbook: SpellbookState = {
    ...(sb as any),
    known,
  } as any;

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
