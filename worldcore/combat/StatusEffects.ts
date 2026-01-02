// worldcore/combat/StatusEffects.ts
//
// v1 status-effect spine for combat.
//
// Goals:
// - Give spells/songs/items a place to attach temporary buffs/debuffs.
// - Keep storage on CharacterState.progression (JSONB) so we don't need a DB migration.
// - Provide one aggregated "snapshot" for combat/stat code to consult.
//
// Nothing actually uses this yet until we explicitly call applyStatusEffect(...).

import type { CharacterState, Attributes } from "../characters/CharacterTypes";
import type { DamageSchool } from "./CombatEngine";

export type StatusEffectId = string;

export type StatusEffectSourceKind =
  | "spell"
  | "song"
  | "item"
  | "ability"
  | "environment";

export interface StatusEffectModifier {
  // Flat attribute bonuses, e.g. { str: +5 }
  attributes?: Partial<Attributes>;

  // Percent attribute bonuses, e.g. { str: 0.10 } = +10% STR
  attributesPct?: Partial<Attributes>;

  // Global multipliers (additive in snapshot; interpret as fractions, e.g. 0.10 = +10%)
  damageDealtPct?: number;
  damageTakenPct?: number;

  // Armor adjustments
  armorFlat?: number;
  armorPct?: number;

  // Per-school resist adjustments
  resistFlat?: Partial<Record<DamageSchool, number>>;
  resistPct?: Partial<Record<DamageSchool, number>>;
}

export interface StatusEffectInstance {
  id: StatusEffectId;
  sourceKind: StatusEffectSourceKind;
  sourceId: string; // spellId, itemId, etc.
  name?: string;

  appliedAtMs: number;
  expiresAtMs: number; // <= now => expired

  stackCount: number;
  maxStacks: number;

  modifiers: StatusEffectModifier;
  tags?: string[];
}

export interface NewStatusEffectInput {
  id: StatusEffectId;
  sourceKind: StatusEffectSourceKind;
  sourceId: string;
  name?: string;

  // How long this effect should last; <=0 means "until cleared".
  durationMs: number;

  maxStacks?: number;
  initialStacks?: number;

  modifiers: StatusEffectModifier;
  tags?: string[];
}

interface InternalStatusState {
  active: Record<string, StatusEffectInstance>;
}

function ensureStatusState(char: CharacterState): InternalStatusState {
  const prog: any = (char as any).progression || {};
  if (!prog.statusEffects || typeof prog.statusEffects !== "object") {
    prog.statusEffects = { active: {} };
  } else if (!prog.statusEffects.active) {
    prog.statusEffects.active = {};
  }
  (char as any).progression = prog;
  return prog.statusEffects as InternalStatusState;
}

/**
 * Apply or refresh a status effect on a character.
 *
 * - If the id already exists: refresh duration, merge stacks, update modifiers/name/tags.
 * - If new: create a fresh instance.
 */
export function applyStatusEffect(
  char: CharacterState,
  input: NewStatusEffectInput,
  now: number = Date.now()
): StatusEffectInstance {
  const state = ensureStatusState(char);
  const existing = state.active[input.id];

  const durationMs =
    typeof input.durationMs === "number" && input.durationMs > 0
      ? input.durationMs
      : 0;
  const expiresAtMs =
    durationMs > 0 ? now + durationMs : Number.MAX_SAFE_INTEGER;

  if (existing) {
    const maxStacks =
      typeof input.maxStacks === "number" && input.maxStacks > 0
        ? input.maxStacks
        : existing.maxStacks || 1;

    const addStacks =
      typeof input.initialStacks === "number" && input.initialStacks > 0
        ? input.initialStacks
        : 1;

    const stackCount = Math.min(
      maxStacks,
      (existing.stackCount || 1) + addStacks
    );

    const updated: StatusEffectInstance = {
      ...existing,
      modifiers: input.modifiers || existing.modifiers,
      name: input.name ?? existing.name,
      tags: input.tags ?? existing.tags,
      stackCount,
      maxStacks,
      appliedAtMs: now,
      // Keep the later expiry if one already existed
      expiresAtMs: Math.max(existing.expiresAtMs, expiresAtMs),
    };

    state.active[input.id] = updated;
    return updated;
  }

  const maxStacks =
    typeof input.maxStacks === "number" && input.maxStacks > 0
      ? input.maxStacks
      : input.initialStacks && input.initialStacks > 0
      ? input.initialStacks
      : 1;

  const stackCount =
    typeof input.initialStacks === "number" && input.initialStacks > 0
      ? input.initialStacks
      : 1;

  const inst: StatusEffectInstance = {
    id: input.id,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    name: input.name,
    appliedAtMs: now,
    expiresAtMs,
    stackCount,
    maxStacks,
    modifiers: input.modifiers || {},
    tags: input.tags,
  };

  state.active[input.id] = inst;
  return inst;
}

export function clearStatusEffect(
  char: CharacterState,
  id: StatusEffectId
): void {
  const state = ensureStatusState(char);
  delete state.active[id];
}

/**
 * Drop expired or zero-stack effects.
 */
export function tickStatusEffects(
  char: CharacterState,
  now: number = Date.now()
): void {
  const state = ensureStatusState(char);
  const active = state.active;
  for (const [id, inst] of Object.entries(active)) {
    if (!inst) continue;
    if (inst.expiresAtMs <= now || inst.stackCount <= 0) {
      delete active[id];
    }
  }
}

export interface CombatStatusSnapshot {
  attributesFlat: Partial<Attributes>;
  attributesPct: Partial<Attributes>;
  damageDealtPct: number;
  damageTakenPct: number;
  armorFlat: number;
  armorPct: number;
  resistFlat: Partial<Record<DamageSchool, number>>;
  resistPct: Partial<Record<DamageSchool, number>>;
}

/**
 * Aggregated view of all active status effects for combat / stats.
 *
 * - Cleans up expired effects.
 * - Sums contributions (taking stacks into account).
 * - Returns a pure snapshot; does not modify attributes directly.
 */
export function computeCombatStatusSnapshot(
  char: CharacterState,
  now: number = Date.now()
): CombatStatusSnapshot {
  // First pass: prune expired
  tickStatusEffects(char, now);
  const state = ensureStatusState(char);

  const attributesFlat: Partial<Attributes> = {};
  const attributesPct: Partial<Attributes> = {};
  const resistFlat: Partial<Record<DamageSchool, number>> = {};
  const resistPct: Partial<Record<DamageSchool, number>> = {};

  let damageDealtPct = 0;
  let damageTakenPct = 0;
  let armorFlat = 0;
  let armorPct = 0;

  for (const inst of Object.values(state.active)) {
    if (!inst) continue;
    const stacks = inst.stackCount > 0 ? inst.stackCount : 1;
    const mods = inst.modifiers || {};

    if (mods.attributes) {
      for (const [k, v] of Object.entries(mods.attributes)) {
        const key = k as keyof Attributes;
        const val = Number(v);
        if (!Number.isFinite(val) || val === 0) continue;
        const cur = (attributesFlat as any)[key] ?? 0;
        (attributesFlat as any)[key] = cur + val * stacks;
      }
    }

    if (mods.attributesPct) {
      for (const [k, v] of Object.entries(mods.attributesPct)) {
        const key = k as keyof Attributes;
        const val = Number(v);
        if (!Number.isFinite(val) || val === 0) continue;
        const cur = (attributesPct as any)[key] ?? 0;
        (attributesPct as any)[key] = cur + val * stacks;
      }
    }

    if (typeof mods.damageDealtPct === "number") {
      damageDealtPct += mods.damageDealtPct * stacks;
    }
    if (typeof mods.damageTakenPct === "number") {
      damageTakenPct += mods.damageTakenPct * stacks;
    }

    if (typeof mods.armorFlat === "number") {
      armorFlat += mods.armorFlat * stacks;
    }
    if (typeof mods.armorPct === "number") {
      armorPct += mods.armorPct * stacks;
    }

    if (mods.resistFlat) {
      for (const [school, v] of Object.entries(mods.resistFlat)) {
        const key = school as DamageSchool;
        const val = Number(v);
        if (!Number.isFinite(val) || val === 0) continue;
        const cur = (resistFlat as any)[key] ?? 0;
        (resistFlat as any)[key] = cur + val * stacks;
      }
    }

    if (mods.resistPct) {
      for (const [school, v] of Object.entries(mods.resistPct)) {
        const key = school as DamageSchool;
        const val = Number(v);
        if (!Number.isFinite(val) || val === 0) continue;
        const cur = (resistPct as any)[key] ?? 0;
        (resistPct as any)[key] = cur + val * stacks;
      }
    }
  }

  return {
    attributesFlat,
    attributesPct,
    damageDealtPct,
    damageTakenPct,
    armorFlat,
    armorPct,
    resistFlat,
    resistPct,
  };
}
