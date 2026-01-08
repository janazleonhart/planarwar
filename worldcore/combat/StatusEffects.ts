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

  // Global multipliers (fractions; 0.10 = +10%)
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
  sourceId: string;
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
 * Drop expired effects and clamp stack counts.
 */
export function tickStatusEffects(
  char: CharacterState,
  now: number = Date.now()
): void {
  const state = ensureStatusState(char);

  for (const [id, inst] of Object.entries(state.active)) {
    if (!inst) {
      delete state.active[id];
      continue;
    }

    const maxStacks = inst.maxStacks > 0 ? inst.maxStacks : 1;

    if (inst.stackCount <= 0) {
      delete state.active[id];
      continue;
    }

    if (inst.stackCount > maxStacks) {
      inst.stackCount = maxStacks;
    }

    if (inst.expiresAtMs > 0 && inst.expiresAtMs <= now) {
      delete state.active[id];
    }
  }
}

/**
 * Apply or refresh a status effect on a character.
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
        : existing.maxStacks > 0
        ? existing.maxStacks
        : 1;

    const addStacks =
      typeof input.initialStacks === "number" && input.initialStacks > 0
        ? input.initialStacks
        : 1;

    const stackCount = Math.min(maxStacks, existing.stackCount + addStacks);

    const updated: StatusEffectInstance = {
      ...existing,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      name: input.name ?? existing.name,
      modifiers: input.modifiers ?? existing.modifiers,
      tags: input.tags ?? existing.tags,
      stackCount,
      maxStacks,
      appliedAtMs: now,
      // Keep the later expiry if one already existed
      expiresAtMs:
        existing.expiresAtMs > 0
          ? Math.max(existing.expiresAtMs, expiresAtMs)
          : expiresAtMs,
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
    modifiers: input.modifiers ?? {},
    tags: input.tags,
  };

  state.active[input.id] = inst;
  return inst;
}

export function clearStatusEffect(char: CharacterState, id: StatusEffectId): void {
  const state = ensureStatusState(char);
  delete state.active[id];
}

export function clearAllStatusEffects(char: CharacterState): void {
  const state = ensureStatusState(char);
  state.active = {};
}

export interface CombatStatusSnapshot {
  // Flat attribute bonuses (additive)
  attributesFlat: Partial<Attributes>;
  // Percent attribute bonuses (0.10 = +10%)
  attributesPct: Partial<Attributes>;

  // Generic outgoing / incoming damage modifiers
  damageDealtPct: number;
  damageTakenPct: number;

  // Armor/resists
  armorFlat: number;
  armorPct: number;
  resistFlat: Partial<Record<DamageSchool, number>>;
  resistPct: Partial<Record<DamageSchool, number>>;
}

/**
 * Convenience helper for UI: get a cleaned list of active effects.
 */
export function getActiveStatusEffects(
  char: CharacterState,
  now: number = Date.now()
): StatusEffectInstance[] {
  tickStatusEffects(char, now);
  const state = ensureStatusState(char);
  return Object.values(state.active).filter(
    (inst): inst is StatusEffectInstance => !!inst
  );
}

/**
 * Aggregate active status effects for combat / stats.
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

  // v1: cowardice penalty from walkto risk mode (if present).
  try {
    const prog: any = (char as any).progression || {};
    const flags: any = prog.flags || {};
    const stacksRaw = Number(flags.walktoCowardiceStacks ?? 0);
    const untilMs = Number(flags.walktoCowardiceUntilMs ?? 0);

    if (
      Number.isFinite(stacksRaw) &&
      stacksRaw > 0 &&
      Number.isFinite(untilMs) &&
      untilMs > now
    ) {
      const stacks = Math.max(0, stacksRaw);

      const perStackRaw = (
        process.env.PW_WALKTO_COWARDICE_DMG_TAKEN_PCT_PER_STACK ?? ""
      )
        .toString()
        .trim();
      const maxRaw = (
        process.env.PW_WALKTO_COWARDICE_DMG_TAKEN_PCT_MAX ?? ""
      )
        .toString()
        .trim();

      let pctPerStack = perStackRaw ? Number(perStackRaw) : 8;
      let pctMax = maxRaw ? Number(maxRaw) : 200;

      if (!Number.isFinite(pctPerStack)) pctPerStack = 8;
      if (!Number.isFinite(pctMax)) pctMax = 200;

      pctPerStack = Math.max(0, pctPerStack);
      pctMax = Math.max(0, pctMax);

      const rawPct = Math.min(pctMax, stacks * pctPerStack);
      if (rawPct > 0) {
        // Convert percentage points to fractional bonus, e.g. 8 -> 0.08.
        damageTakenPct += rawPct / 100;
      }
    }
  } catch {
    // Best-effort only; cowardice flags should never break combat math.
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
