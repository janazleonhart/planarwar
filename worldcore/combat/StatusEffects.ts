// worldcore/combat/StatusEffects.ts
//
// v1 status-effect spine for combat.
//
// Storage:
//  - Characters: CharacterState.progression.statusEffects (JSON-ish)
//  - Entities (NPCs): (entity as any).combatStatusEffects (JSON-ish)
//
// Snapshot:
//  - computeCombatStatusSnapshot(char) returns a pure aggregated view.
//  - computeEntityCombatStatusSnapshot(entity) does the same for NPCs.
//
// DOT:
//  - DOTs are stored as status effects with an optional `dot` payload.
//  - TickEngine (and tests) can call tickEntityStatusEffectsAndApplyDots(...) to apply periodic damage.
//
// Stacking (extended):
//  - Default behavior is legacy: one instance per id, stacks add, expiry extends.
//  - Optional `stackingPolicy` adds additional behaviors including:
//      - "refresh"              (no stack increase, refresh/extend only)
//      - "stack_add"            (explicit stacks + refresh)
//      - "versioned_by_applier" (distinct versions stack iff from distinct appliers, capped)
//
// NOTE: sourceKind/sourceId are OPTIONAL so tests/tools can apply ad-hoc effects
// without needing to invent provenance every time.

import type { CharacterState, Attributes } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";
import type { DamageSchool } from "./CombatEngine";
import { resolveStatusStackingPolicy, type StatusStackingPolicy } from "./StatusStackingPolicy";

export type StatusEffectId = string;

export type StatusEffectSourceKind =
  | "spell"
  | "song"
  | "item"
  | "ability"
  | "environment";

export type StatusEffectApplierKind = "character" | "npc" | "system" | "unknown";

export interface StatusEffectModifier {
  // Flat attribute bonuses, e.g. { str: +5 }
  attributes?: Partial<Attributes>;

  // Percent attribute bonuses, e.g. { str: 0.10 } = +10% STR
  attributesPct?: Partial<Attributes>;

  // Global multipliers (fractions; 0.10 = +10%)
  damageDealtPct?: number;
  damageTakenPct?: number;

  // Per-school multipliers (fractions; 0.10 = +10%)
  damageDealtPctBySchool?: Partial<Record<DamageSchool, number>>;
  damageTakenPctBySchool?: Partial<Record<DamageSchool, number>>;

  // Armor adjustments
  armorFlat?: number;
  armorPct?: number;

  // Per-school resist adjustments
  resistFlat?: Partial<Record<DamageSchool, number>>;
  resistPct?: Partial<Record<DamageSchool, number>>;
}

export interface DotPayloadInput {
  tickIntervalMs: number;
  /** Base damage per tick (before defender damageTaken modifiers). */
  perTickDamage: number;
  /** Damage school for defender taken modifiers / resists (default: "pure"). */
  damageSchool?: DamageSchool;
}

export interface DotPayloadState extends DotPayloadInput {
  /** Internal scheduler: next time we should tick. */
  nextTickAtMs: number;
}

export interface StatusEffectInstance {
  id: StatusEffectId;
  sourceKind: StatusEffectSourceKind;
  sourceId: string;
  name?: string;
  appliedAtMs: number;
  expiresAtMs: number; // < now => expired (note: strict '<' so expiry moment is inclusive)
  stackCount: number;
  maxStacks: number;
  modifiers: StatusEffectModifier;
  tags?: string[];

  // Optional DOT payload (NPCs today; can be used on players later if desired)
  dot?: DotPayloadState;

  // ────────────────────────────────────────────────────────────────────────────
  // Optional extended stacking metadata (safe to ignore for legacy effects)
  // ────────────────────────────────────────────────────────────────────────────
  stackingPolicy?: StatusStackingPolicy;
  stackingGroupId?: string;

  /** Who applied this specific instance (used by versioned_by_applier). */
  appliedByKind?: StatusEffectApplierKind;
  appliedById?: string;

  /** Version key (defaults to sourceId). Only relevant for versioned_by_applier. */
  versionKey?: string;
}

export interface NewStatusEffectInput {
  id: StatusEffectId;
  sourceKind?: StatusEffectSourceKind;
  sourceId?: string;
  name?: string;

  // How long this effect should last; <=0 means "until cleared".
  durationMs: number;

  maxStacks?: number;

  // How many stacks to apply with this application (defaults to 1).
  // If effect already exists, this is how many stacks are added (legacy).
  initialStacks?: number;

  /**
   * Back-compat alias for initialStacks (some call sites used 'stacks').
   * Prefer initialStacks going forward.
   */
  stacks?: number;

  modifiers: StatusEffectModifier;
  tags?: string[];

  // Optional DOT payload (stored on the status instance).
  dot?: DotPayloadInput;

  // ────────────────────────────────────────────────────────────────────────────
  // Optional extended stacking controls
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Stacking policy (rules of the universe).
   *
   * Default: "legacy_add" (one instance per id; stacks add; expiry extends).
   */
  stackingPolicy?: StatusStackingPolicy;

  /**
   * Optional grouping key used for storage/stacking. Defaults to `id`.
   * Useful if multiple different effect ids should share a stacking bucket.
   */
  stackingGroupId?: string;

  /**
   * Identity of the applier (caster). Used for versioned_by_applier:
   * each applier can contribute at most one active instance in the bucket.
   */
  appliedByKind?: StatusEffectApplierKind;
  appliedById?: string;

  /**
   * Version key for versioned_by_applier. Defaults to sourceId.
   * Typically the spell id (rank1/rank2/etc).
   */
  versionKey?: string;
}

type ActiveBucket = StatusEffectInstance | StatusEffectInstance[];

interface InternalStatusState {
  active: Record<string, ActiveBucket>;
}

/**
 * Character storage: CharacterState.progression.statusEffects.active
 */
function ensureStatusState(char: CharacterState): InternalStatusState {
  const prog: any = (char as any).progression || {};

  if (!prog.statusEffects || typeof prog.statusEffects !== "object") {
    prog.statusEffects = { active: {} as Record<string, ActiveBucket> };
  } else if (!prog.statusEffects.active) {
    prog.statusEffects.active = {} as Record<string, ActiveBucket>;
  }

  (char as any).progression = prog;
  return prog.statusEffects as InternalStatusState;
}

/**
 * Entity storage (NPCs): (entity as any).combatStatusEffects.active
 */
function ensureEntityStatusState(entity: Entity): InternalStatusState {
  const e: any = entity as any;

  if (!e.combatStatusEffects || typeof e.combatStatusEffects !== "object") {
    e.combatStatusEffects = { active: {} as Record<string, ActiveBucket> };
  } else if (!e.combatStatusEffects.active) {
    e.combatStatusEffects.active = {} as Record<string, ActiveBucket>;
  }

  return e.combatStatusEffects as InternalStatusState;
}

function normalizeBucket(bucket: ActiveBucket | undefined | null): StatusEffectInstance[] {
  if (!bucket) return [];
  if (Array.isArray(bucket)) return bucket.filter(Boolean);
  return bucket ? [bucket] : [];
}

function writeBucket(state: InternalStatusState, key: string, items: StatusEffectInstance[]): void {
  const list = items.filter(Boolean);
  if (list.length <= 0) {
    delete state.active[key];
  } else if (list.length === 1) {
    state.active[key] = list[0]!;
  } else {
    state.active[key] = list;
  }
}

function resolveInitialStacks(input: NewStatusEffectInput): number {
  return typeof input.initialStacks === "number" && input.initialStacks > 0
    ? input.initialStacks
    : typeof (input as any).stacks === "number" && (input as any).stacks > 0
      ? Number((input as any).stacks)
      : 1;
}

function resolveMaxStacks(input: NewStatusEffectInput, fallback: number): number {
  return typeof input.maxStacks === "number" && input.maxStacks > 0
    ? input.maxStacks
    : fallback > 0
      ? fallback
      : 1;
}

function resolveExpiresAt(now: number, durationMs: number): number {
  const dur =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : 0;

  return dur > 0 ? now + dur : Number.MAX_SAFE_INTEGER;
}

function resolveDot(
  input: NewStatusEffectInput,
  now: number,
  existingDot?: DotPayloadState,
): DotPayloadState | undefined {
  if (!input.dot) return existingDot;

  const tickIntervalMs = Math.max(1, Math.floor(Number(input.dot.tickIntervalMs ?? 0)));
  const perTickDamage = Math.max(1, Math.floor(Number(input.dot.perTickDamage ?? 0)));
  const damageSchool: DamageSchool =
    (input.dot.damageSchool as DamageSchool) ?? (existingDot?.damageSchool as any) ?? "pure";

  return {
    tickIntervalMs,
    perTickDamage,
    damageSchool,
    nextTickAtMs: now + tickIntervalMs,
  };
}

function resolvePolicy(input: NewStatusEffectInput): StatusStackingPolicy {
  // Default is the historical behavior.
  return resolveStatusStackingPolicy(input.stackingPolicy, "legacy_add");
}

/**
 * Drop expired effects and clamp stack counts.
 */
export function tickStatusEffects(
  char: CharacterState,
  now: number = Date.now(),
): void {
  tickStatusEffectsInternal(ensureStatusState(char), now);
}

export function tickEntityStatusEffects(
  entity: Entity,
  now: number = Date.now(),
): void {
  tickStatusEffectsInternal(ensureEntityStatusState(entity), now);
}

function tickStatusEffectsInternal(state: InternalStatusState, now: number): void {
  for (const [key, bucket] of Object.entries(state.active)) {
    const items = normalizeBucket(bucket);
    const kept: StatusEffectInstance[] = [];

    for (const inst of items) {
      if (!inst) continue;

      const maxStacks = inst.maxStacks > 0 ? inst.maxStacks : 1;

      if (inst.stackCount <= 0) {
        continue;
      }

      if (inst.stackCount > maxStacks) {
        inst.stackCount = maxStacks;
      }

      // NOTE: strict '<' so an effect expiring at now is still present for this moment.
      if (inst.expiresAtMs > 0 && inst.expiresAtMs < now) {
        continue;
      }

      kept.push(inst);
    }

    writeBucket(state, key, kept);
  }
}

/**
 * Apply or refresh a status effect on a character.
 */
export function applyStatusEffect(
  char: CharacterState,
  input: NewStatusEffectInput,
  now: number = Date.now(),
): StatusEffectInstance {
  return applyStatusEffectInternal(ensureStatusState(char), input, now);
}

/**
 * Apply or refresh a status effect on an entity (NPC).
 */
export function applyStatusEffectToEntity(
  entity: Entity,
  input: NewStatusEffectInput,
  now: number = Date.now(),
): StatusEffectInstance {
  return applyStatusEffectInternal(ensureEntityStatusState(entity), input, now);
}

/**
 * Internal apply logic (supports legacy + policy-based stacking).
 */
function applyStatusEffectInternal(
  state: InternalStatusState,
  input: NewStatusEffectInput,
  now: number,
): StatusEffectInstance {
  const sourceKind: StatusEffectSourceKind = input.sourceKind ?? "environment";
  const sourceId = input.sourceId ?? "unknown";

  const bucketKey = (typeof input.stackingGroupId === "string" && input.stackingGroupId.trim())
    ? input.stackingGroupId.trim()
    : input.id;

  const policy = resolvePolicy(input);

  const expiresAtMs = resolveExpiresAt(now, input.durationMs);
  const existingBucket = state.active[bucketKey];
  const existingList = normalizeBucket(existingBucket);

  const initialStacks = resolveInitialStacks(input);

  // For non-versioned policies, maxStacks is per-effect as before.
  // For versioned_by_applier, maxStacks acts as a CONTRIBUTOR/VERSION CAP (bucket size cap).
  const resolvedMaxStacks = resolveMaxStacks(
    input,
    existingList[0]?.maxStacks ?? initialStacks,
  );

  // ────────────────────────────────────────────────────────────────────────────
  // versioned_by_applier: multiple instances per bucket (distinct versions),
  // but only if applied by different appliers.
  // ────────────────────────────────────────────────────────────────────────────
  if (policy === "versioned_by_applier") {
    const versionKey =
      typeof input.versionKey === "string" && input.versionKey.trim()
        ? input.versionKey.trim()
        : sourceId;

    const appliedById =
      typeof input.appliedById === "string" && input.appliedById.trim()
        ? input.appliedById.trim()
        : "unknown";

    const appliedByKind: StatusEffectApplierKind = input.appliedByKind ?? "unknown";

    const idxByApplier = existingList.findIndex((e) => (e.appliedById ?? "unknown") === appliedById);
    const idxByVersion = existingList.findIndex((e) => (e.versionKey ?? e.sourceId ?? "unknown") === versionKey);

    const pickIdx = idxByApplier >= 0 ? idxByApplier : idxByVersion;

    const existing =
      pickIdx >= 0 ? existingList[pickIdx] : undefined;

    const dot = resolveDot(input, now, existing?.dot);

    const inst: StatusEffectInstance = {
      id: input.id,
      sourceKind,
      sourceId,
      name: input.name ?? existing?.name,
      appliedAtMs: now,
      // Keep the later expiry if one already existed in this slot.
      expiresAtMs:
        existing?.expiresAtMs != null && existing.expiresAtMs > 0
          ? Math.max(existing.expiresAtMs, expiresAtMs)
          : expiresAtMs,
      // Under versioned_by_applier, stacks are intentionally NOT the main axis;
      // the bucket size is the cap. Keep per-instance stacks minimal and deterministic.
      stackCount: 1,
      maxStacks: resolvedMaxStacks,
      modifiers: input.modifiers ?? existing?.modifiers ?? {},
      tags: input.tags ?? existing?.tags,
      dot,

      stackingPolicy: policy,
      stackingGroupId: bucketKey,
      appliedByKind,
      appliedById,
      versionKey,
    };

    // Update/replace an existing slot
    if (pickIdx >= 0) {
      existingList[pickIdx] = inst;
      writeBucket(state, bucketKey, existingList);
      return inst;
    }

    // Add a new contributor slot if below cap.
    if (existingList.length < resolvedMaxStacks) {
      existingList.push(inst);
      writeBucket(state, bucketKey, existingList);
      return inst;
    }

    // Cap reached: reject new contribution, but still allow refresh if we had a match
    // (handled above). Return the "oldest" as a stable return value.
    const fallback = existingList[0];
    return fallback ?? inst;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Non-versioned policies: single instance per bucketKey
  // ────────────────────────────────────────────────────────────────────────────
  const existing = existingList[0];
  const dot = resolveDot(input, now, existing?.dot);

  if (existing) {
    const maxStacks = resolvedMaxStacks;

    let stackCount = existing.stackCount;
    if (policy !== "refresh") {
      // legacy_add / stack_add: add stacks
      stackCount = Math.min(maxStacks, existing.stackCount + initialStacks);
    } else {
      // refresh: keep current stackCount, but clamp to maxStacks
      stackCount = Math.min(maxStacks, existing.stackCount);
    }

    const updated: StatusEffectInstance = {
      ...existing,
      sourceKind,
      sourceId,
      name: input.name ?? existing.name,
      modifiers: input.modifiers ?? existing.modifiers,
      tags: input.tags ?? existing.tags,
      stackCount,
      maxStacks,
      appliedAtMs: now,
      // Keep the later expiry if one already existed
      expiresAtMs:
        existing.expiresAtMs > 0 ? Math.max(existing.expiresAtMs, expiresAtMs) : expiresAtMs,
      dot,

      stackingPolicy: policy,
      stackingGroupId: bucketKey,
    };

    writeBucket(state, bucketKey, [updated]);
    return updated;
  }

  const inst: StatusEffectInstance = {
    id: input.id,
    sourceKind,
    sourceId,
    name: input.name,
    appliedAtMs: now,
    expiresAtMs,
    stackCount: initialStacks,
    maxStacks: resolvedMaxStacks,
    modifiers: input.modifiers ?? {},
    tags: input.tags,
    dot,

    stackingPolicy: policy,
    stackingGroupId: bucketKey,
  };

  writeBucket(state, bucketKey, [inst]);
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

export function clearStatusEffectFromEntity(entity: Entity, id: StatusEffectId): void {
  const state = ensureEntityStatusState(entity);
  delete state.active[id];
}

export function clearAllStatusEffectsFromEntity(entity: Entity): void {
  const state = ensureEntityStatusState(entity);
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

  // Per-school outgoing / incoming damage modifiers
  damageDealtPctBySchool: Partial<Record<DamageSchool, number>>;
  damageTakenPctBySchool: Partial<Record<DamageSchool, number>>;

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
  now: number = Date.now(),
): StatusEffectInstance[] {
  tickStatusEffects(char, now);
  const state = ensureStatusState(char);

  const out: StatusEffectInstance[] = [];
  for (const bucket of Object.values(state.active)) {
    for (const inst of normalizeBucket(bucket)) {
      if (inst) out.push(inst);
    }
  }
  return out;
}

export function getActiveStatusEffectsForEntity(
  entity: Entity,
  now: number = Date.now(),
): StatusEffectInstance[] {
  tickEntityStatusEffects(entity, now);
  const state = ensureEntityStatusState(entity);

  const out: StatusEffectInstance[] = [];
  for (const bucket of Object.values(state.active)) {
    for (const inst of normalizeBucket(bucket)) {
      if (inst) out.push(inst);
    }
  }
  return out;
}

function addSchoolMap(
  dst: Partial<Record<DamageSchool, number>>,
  src: Partial<Record<DamageSchool, number>> | undefined,
  stacks: number,
): void {
  if (!src) return;
  for (const [k, v] of Object.entries(src)) {
    const key = k as DamageSchool;
    const val = Number(v);
    if (!Number.isFinite(val) || val === 0) continue;
    const cur = (dst as any)[key] ?? 0;
    (dst as any)[key] = cur + val * stacks;
  }
}

function computeSnapshotFromState(
  state: InternalStatusState,
  now: number,
): CombatStatusSnapshot {
  // First pass: prune expired
  tickStatusEffectsInternal(state, now);

  const attributesFlat: Partial<Attributes> = {};
  const attributesPct: Partial<Attributes> = {};
  const resistFlat: Partial<Record<DamageSchool, number>> = {};
  const resistPct: Partial<Record<DamageSchool, number>> = {};

  const damageDealtPctBySchool: Partial<Record<DamageSchool, number>> = {};
  const damageTakenPctBySchool: Partial<Record<DamageSchool, number>> = {};

  let damageDealtPct = 0;
  let damageTakenPct = 0;
  let armorFlat = 0;
  let armorPct = 0;

  for (const bucket of Object.values(state.active)) {
    for (const inst of normalizeBucket(bucket)) {
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

      if (typeof mods.damageDealtPct === "number" && Number.isFinite(mods.damageDealtPct)) {
        damageDealtPct += mods.damageDealtPct * stacks;
      }

      if (typeof mods.damageTakenPct === "number" && Number.isFinite(mods.damageTakenPct)) {
        damageTakenPct += mods.damageTakenPct * stacks;
      }

      addSchoolMap(damageDealtPctBySchool, mods.damageDealtPctBySchool, stacks);
      addSchoolMap(damageTakenPctBySchool, mods.damageTakenPctBySchool, stacks);

      if (typeof mods.armorFlat === "number" && Number.isFinite(mods.armorFlat)) {
        armorFlat += mods.armorFlat * stacks;
      }

      if (typeof mods.armorPct === "number" && Number.isFinite(mods.armorPct)) {
        armorPct += mods.armorPct * stacks;
      }

      if (mods.resistFlat) {
        addSchoolMap(resistFlat, mods.resistFlat, stacks);
      }

      if (mods.resistPct) {
        addSchoolMap(resistPct, mods.resistPct, stacks);
      }
    }
  }

  return {
    attributesFlat,
    attributesPct,
    damageDealtPct,
    damageTakenPct,
    damageDealtPctBySchool,
    damageTakenPctBySchool,
    armorFlat,
    armorPct,
    resistFlat,
    resistPct,
  };
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
  now: number = Date.now(),
): CombatStatusSnapshot {
  const state = ensureStatusState(char);
  return computeSnapshotFromState(state, now);
}

export function computeEntityCombatStatusSnapshot(
  entity: Entity,
  now: number = Date.now(),
): CombatStatusSnapshot {
  const state = ensureEntityStatusState(entity);
  return computeSnapshotFromState(state, now);
}

// Back-compat aliases for newer call sites (if any)
export const computeCombatStatusSnapshotForEntity = computeEntityCombatStatusSnapshot;

export type DotTickEvent = {
  effectId: StatusEffectId;
  damage: number;
  school: DamageSchool;
};

/**
 * Tick DOT payloads on an entity (NPC) and apply damage via callback.
 *
 * This function:
 *  - prunes expired effects
 *  - computes defender taken modifiers ONCE per call
 *  - emits one or more dot ticks if time advanced beyond the next tick time
 *
 * Note: damage application is intentionally handled externally so callers can route it
 * through NpcManager (crime/aggro hooks) or just subtract hp in tests.
 */
export function tickEntityStatusEffectsAndApplyDots(
  entity: Entity,
  now: number,
  applyDamage: (amount: number, meta: DotTickEvent) => void,
): void {
  const state = ensureEntityStatusState(entity);

  // Prune first so we don't tick dead effects.
  tickStatusEffectsInternal(state, now);

  let defenderStatus: CombatStatusSnapshot | null = null;
  try {
    defenderStatus = computeSnapshotFromState(state, now);
  } catch {
    defenderStatus = null;
  }

  for (const bucket of Object.values(state.active)) {
    for (const inst of normalizeBucket(bucket)) {
      if (!inst?.dot) continue;

      const dot = inst.dot;
      const tickIntervalMs = Math.max(1, Math.floor(Number(dot.tickIntervalMs ?? 0)));
      const perTickDamageBase = Math.max(1, Math.floor(Number(dot.perTickDamage ?? 0)));
      const school: DamageSchool = (dot.damageSchool as DamageSchool) ?? "pure";

      if (!Number.isFinite(tickIntervalMs) || tickIntervalMs <= 0) continue;
      if (!Number.isFinite(perTickDamageBase) || perTickDamageBase <= 0) continue;

      if (!Number.isFinite(dot.nextTickAtMs) || dot.nextTickAtMs <= 0) {
        dot.nextTickAtMs = (inst.appliedAtMs ?? now) + tickIntervalMs;
      }

      // Inclusive end: allow a tick exactly at expiresAtMs.
      const expiresAt = inst.expiresAtMs ?? Number.MAX_SAFE_INTEGER;

      while (dot.nextTickAtMs <= now && dot.nextTickAtMs <= expiresAt) {
        let dmg = perTickDamageBase;

        // Apply defender taken modifiers at tick time (debuffs amplify DOTs too).
        if (defenderStatus) {
          const globalTaken =
            typeof defenderStatus.damageTakenPct === "number" ? defenderStatus.damageTakenPct : 0;
          const bySchoolTaken = (defenderStatus.damageTakenPctBySchool as any)?.[school];
          const bySchoolN = typeof bySchoolTaken === "number" ? bySchoolTaken : 0;

          const takenPct =
            (Number.isFinite(globalTaken) ? globalTaken : 0) +
            (Number.isFinite(bySchoolN) ? bySchoolN : 0);

          if (takenPct) {
            const after = dmg * (1 + takenPct);
            dmg = Number.isFinite(after) && after > 0 ? Math.floor(after) : dmg;
          }
        }

        if (!Number.isFinite(dmg) || dmg < 1) dmg = 1;

        try {
          applyDamage(dmg, { effectId: inst.id, damage: dmg, school });
        } catch {
          // DOT application must never crash the tick loop.
        }

        dot.nextTickAtMs += tickIntervalMs;
      }
    }
  }

  // Prune again (expiry moment inclusive, so this will clean up on the next tick).
  tickStatusEffectsInternal(state, now);
}
