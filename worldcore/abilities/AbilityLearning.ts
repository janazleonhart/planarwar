// worldcore/abilities/AbilityLearning.ts
//
// Pure helpers for:
// - determining which abilities are known (auto-grant + learned)
// - determining which abilities are learnable
// - applying a "learn ability" mutation to CharacterState (in-memory)
//
// This is intentionally DB-agnostic and side-effect free.
// Persistence happens in PostgresCharacterService.learnAbilityWithRules().

import type { CharacterState } from "../characters/CharacterTypes";
import type { AbilityDefinition } from "./AbilityTypes";

import { ABILITIES } from "./AbilityTypes";
import {
  getAbilityUnlockSource,
  getAllAbilityUnlockRules,
  getAutoGrantAbilityUnlocksFor,
  getLearnableAbilityUnlocksFor,
  resolveAbilityKey,
  type AbilityUnlockRule,
} from "./AbilityUnlocks";

export type AbilityKnownEntry = {
  rank?: number;
  learnedAt?: number; // unix ms
} | true;

export type AbilityBookState = {
  learned?: Record<string, AbilityKnownEntry>;
  /**
   * Rank system v0.1: "granted but not trained" ability ids.
   * Higher ranks can be granted via content, but require a trainer flow to learn.
   */
  pending?: Record<string, { grantedAt: number; source?: string }>;
  [k: string]: any;
};

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

function normalizeAbilityKey(abilityIdRaw: string): string {
  const raw = String(abilityIdRaw ?? "").trim();
  if (!raw) return "";
  return resolveAbilityKey(raw) ?? raw;
}

function ensureAbilityBook(char: CharacterState): AbilityBookState {
  const ab = ((char as any).abilities ?? {}) as AbilityBookState;
  (char as any).abilities = ab;
  if (!ab.learned || typeof ab.learned !== "object") ab.learned = {};
  if (!ab.pending || typeof ab.pending !== "object") ab.pending = {};
  return ab;
}

export function listPendingAbilitiesForChar(char: CharacterState): string[] {
  const ab = ensureAbilityBook(char);
  return Object.keys(ab.pending ?? {}).sort();
}

export function grantAbilityInState(char: CharacterState, abilityIdRaw: string, source?: string, nowMs?: number): { ok: true; next: CharacterState } | { ok: false; error: "unknown_ability" } {
  const raw = String(abilityIdRaw ?? "").trim();
  const abilityId = normalizeAbilityKey(raw);
  if (!abilityId) return { ok: false, error: "unknown_ability" };

  // Only grant real definitions.
  const def = (ABILITIES as any)[abilityId] as AbilityDefinition | undefined;
  if (!def) return { ok: false, error: "unknown_ability" };

  const ab = ensureAbilityBook(char);
  const pending = { ...(ab.pending ?? {}) } as any;
  pending[abilityId] = { grantedAt: safeNow(nowMs), source: source ? String(source) : undefined };

  const next: CharacterState = {
    ...char,
    abilities: {
      ...(char as any).abilities,
      pending,
    },
  } as any;

  return { ok: true, next };
}

function hasPendingAbilityGrant(char: CharacterState, abilityId: string): boolean {
  const ab = ensureAbilityBook(char);
  return !!(ab.pending as any)?.[abilityId];
}

export function isAbilityKnownForChar(char: CharacterState, abilityIdRaw: string): boolean {
  const raw = String(abilityIdRaw ?? "").trim();
  const abilityKey = normalizeAbilityKey(raw);
  if (!abilityKey) return false;

  // Ensure learned map exists
  const ab = ensureAbilityBook(char);

  // Learned explicitly?
  if (ab.learned && ((ab.learned as any)[abilityKey] || (raw && (ab.learned as any)[raw]))) return true;

  // Auto-grant rules may also mark it known (without persistence).
  const cls = getSafeClassId(char);
  const lvl = getSafeLevel(char);

  // If unlock source is DB/test, we require that the ability is present in rules.
  // Otherwise (code fallback), preserve legacy behavior by allowing AbilityTypes gating.
  const source = getAbilityUnlockSource();
  if (source === "db" || source === "test") {
    const auto = getAutoGrantAbilityUnlocksFor(cls, lvl);
    return auto.some((r) => String(r.abilityId) === abilityKey);
  }

  // Legacy fallback: class+level filter from AbilityTypes
  const def = (ABILITIES as any)[abilityKey] as AbilityDefinition | undefined;
  if (!def) return false;
  const dClass = String(def.classId ?? "any").toLowerCase();
  if (dClass !== "any" && dClass !== cls) return false;
  return lvl >= Number(def.minLevel ?? 1);
}

export function listKnownAbilitiesForChar(char: CharacterState): AbilityDefinition[] {
  const cls = getSafeClassId(char);
  const lvl = getSafeLevel(char);

  const source = getAbilityUnlockSource();

  if (source === "db" || source === "test") {
    // Known = explicit learned + auto-grants
    const ab = ensureAbilityBook(char);
    const learnedIds = new Set<string>(Object.keys(ab.learned ?? {}));

    for (const r of getAutoGrantAbilityUnlocksFor(cls, lvl)) {
      learnedIds.add(r.abilityId);
    }

    const out: AbilityDefinition[] = [];
    for (const id of learnedIds) {
      const def = (ABILITIES as any)[id] as AbilityDefinition | undefined;
      if (!def) continue;
      // Still enforce basic def gating (learned can override minLevel).
      // Allow def.classId "any" to be known by any class.
      const dClass = String(def.classId ?? "any").toLowerCase();
      if (dClass !== "any" && dClass !== cls) continue;
      out.push(def);
    }

    out.sort((a, b) => (Number(a.minLevel ?? 1) - Number(b.minLevel ?? 1)) || a.name.localeCompare(b.name));
    return out;
  }

  // Legacy fallback: what you had before (class+minLevel gating)
  return Object.values(ABILITIES).filter((a: any) => {
    const aClass = String(a.classId ?? "").toLowerCase();
    if (cls && aClass && aClass !== cls) return false;
    if (lvl < (a.minLevel ?? 1)) return false;
    return true;
  });
}

export type LearnAbilityResult =
  | { ok: true; next: CharacterState }
  | {
      ok: false;
      error:
        | "unknown_ability"
        | "not_learnable"
        | "level_too_low"
        | "class_mismatch"
        | "requires_trainer"
        | "requires_grant";
      requiredRule?: AbilityUnlockRule;
    };

export type LearnAbilityOpts = {
  /** Set true when invoked via an in-town trainer flow. */
  viaTrainer?: boolean;
  /** Debug/dev bypass for content-grant requirements. */
  bypassGrant?: boolean;
};

export function canLearnAbilityForChar(
  char: CharacterState,
  abilityIdRaw: string,
  opts?: LearnAbilityOpts,
): LearnAbilityResult {
  const raw = String(abilityIdRaw ?? "").trim();
  const abilityKey = normalizeAbilityKey(raw);
  if (!abilityKey) return { ok: false, error: "unknown_ability" };

  const def = (ABILITIES as any)[abilityKey] as AbilityDefinition | undefined;
  if (!def) return { ok: false, error: "unknown_ability" };

  const requiresTrainer = !!(def as any).learnRequiresTrainer || Number((def as any).rank ?? 1) > 1;
  if (requiresTrainer && !opts?.viaTrainer) return { ok: false, error: "requires_trainer" };

  const requiresGrant = Number((def as any).rank ?? 1) > 1;
  if (requiresGrant && !opts?.bypassGrant) {
    const ab = ensureAbilityBook(char);
    if (!(ab.pending && (ab.pending as any)[abilityKey])) {
      return { ok: false, error: "requires_grant" };
    }
  }

  const cls = getSafeClassId(char);
  const lvl = getSafeLevel(char);

  // If already known, treat as ok (idempotent).
  if (isAbilityKnownForChar(char, abilityKey)) {
    return { ok: true, next: char };
  }

  // DB/test source: require explicit rule.
  const source = getAbilityUnlockSource();
  if (source === "db" || source === "test") {
    const rules = getAllAbilityUnlockRules().filter((r) => r && (r as any).isEnabled !== false);
    const rule = rules.find((r) => String(r.abilityId) === abilityKey && (String(r.classId).toLowerCase() === "any" || String(r.classId).toLowerCase() === cls));
    if (!rule) return { ok: false, error: "not_learnable" };

    if (lvl < Number(rule.minLevel ?? 1)) return { ok: false, error: "level_too_low", requiredRule: rule };

    // Allow rule to specify "any" class, otherwise must match
    const dClass = String(def.classId ?? "any").toLowerCase();
    if (String(rule.classId).toLowerCase() !== "any" && dClass !== "any" && dClass !== cls) {
      return { ok: false, error: "class_mismatch", requiredRule: rule };
    }

    return { ok: true, next: char };
  }

  // Code fallback: allow if def matches class and level (same as legacy availability).
  if (String(def.classId ?? "").toLowerCase() !== cls) return { ok: false, error: "class_mismatch" };
  if (lvl < Number(def.minLevel ?? 1)) return { ok: false, error: "level_too_low" };

  return { ok: true, next: char };
}

export function learnAbilityInState(
  char: CharacterState,
  abilityIdRaw: string,
  rank = 1,
  nowMs?: number,
  opts?: LearnAbilityOpts,
): LearnAbilityResult {
  const check = canLearnAbilityForChar(char, abilityIdRaw, opts);
  if (!check.ok) return check;

  const raw = String(abilityIdRaw ?? "").trim();
  const abilityId = normalizeAbilityKey(raw);
  const ab = ensureAbilityBook(char);
  const learned = { ...(ab.learned ?? {}) };

  // Rank v0: keep only the highest learned rank per rankGroupId.
  {
    const def: any = (ABILITIES as any)[abilityId];
    const gid = String(def?.rankGroupId ?? abilityId).trim().toLowerCase();
    const learnedRank = Number(def?.rank ?? rank ?? 1);
    if (gid) {
      for (const existingId of Object.keys(learned)) {
        if (existingId === abilityId) continue;
        const eDef: any = (ABILITIES as any)[existingId];
        const eGid = String(eDef?.rankGroupId ?? existingId).trim().toLowerCase();
        if (!eGid || eGid !== gid) continue;
        const eRank = Number(eDef?.rank ?? 1);
        if (eRank >= learnedRank) {
          // Equal/higher already learned -> no-op
          return { ok: true, next: char };
        }
        delete (learned as any)[existingId];
      }
    }
  }

  if (!learned[abilityId]) {
    learned[abilityId] = {
      rank,
      learnedAt: safeNow(nowMs),
    };
  }

  const next: CharacterState = {
    ...char,
    abilities: {
      ...(char as any).abilities,
      learned,
      pending: {
        ...(ab.pending ?? {}),
      },
    },
  } as any;

  // Consume grant if present.
  if ((next as any).abilities?.pending && (next as any).abilities.pending[abilityId]) {
    const p = { ...(next as any).abilities.pending };
    delete p[abilityId];
    (next as any).abilities.pending = p;
  }

  return { ok: true, next };
}

export function listLearnableAbilitiesForChar(char: CharacterState): AbilityUnlockRule[] {
  const cls = getSafeClassId(char);
  const lvl = getSafeLevel(char);
  return getLearnableAbilityUnlocksFor(cls, lvl);
}
