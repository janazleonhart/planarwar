// worldcore/status/ServerBuffs.ts
//
// Server-wide buffs / events / donation perks.
// Uses the same StatusEffects spine as player/NPC buffs.
//
// v1: in-memory only. A later slice can persist this list (db/redis).

import type { EntityManager } from "../core/EntityManager";
import type { SessionManager } from "../core/SessionManager";
import type { Session } from "../shared/Session";
import type { CharacterState } from "../characters/CharacterTypes";
import {
  applyStatusEffect,
  clearStatusEffect,
  getActiveStatusEffects,
} from "../combat/StatusEffects";
import type {
  NewStatusEffectInput,
  StatusEffectModifier,
  StatusEffectSourceKind,
} from "../combat/StatusEffects";

export interface ServerBuffRecord {
  /** Logical id used by admin commands. */
  id: string;
  /** Actual status effect id stored on characters. */
  effectId: string;
  name?: string;
  appliedAtMs: number;
  /** Number.MAX_SAFE_INTEGER means "until removed". */
  expiresAtMs: number;
  modifiers: StatusEffectModifier;
  tags?: string[];
  sourceKind: StatusEffectSourceKind;
  sourceId: string;
  maxStacks?: number;
  initialStacks?: number;
}

const ACTIVE: Map<string, ServerBuffRecord> = new Map();

function toEffectId(id: string): string {
  return `server_buff:${id}`;
}

export function listServerBuffs(nowMs: number = Date.now()): ServerBuffRecord[] {
  // prune expired
  for (const [id, b] of [...ACTIVE.entries()]) {
    if (b.expiresAtMs !== Number.MAX_SAFE_INTEGER && b.expiresAtMs <= nowMs) {
      ACTIVE.delete(id);
    }
  }
  return [...ACTIVE.values()];
}

export function addServerBuff(
  id: string,
  input: Omit<NewStatusEffectInput, "id" | "durationMs"> & {
    durationMs: number;
    name?: string;
    sourceKind?: StatusEffectSourceKind;
    sourceId?: string;
  },
  nowMs: number = Date.now(),
): ServerBuffRecord {
  const durationMs = Number(input.durationMs ?? 0);
  const expiresAtMs = durationMs <= 0 ? Number.MAX_SAFE_INTEGER : nowMs + durationMs;

  const rec: ServerBuffRecord = {
    id,
    effectId: toEffectId(id),
    name: input.name,
    appliedAtMs: nowMs,
    expiresAtMs,
    modifiers: input.modifiers,
    tags: input.tags,
    sourceKind: input.sourceKind ?? "environment",
    sourceId: input.sourceId ?? "server",
    maxStacks: input.maxStacks,
    initialStacks: input.initialStacks ?? input.stacks,
  };

  ACTIVE.set(id, rec);
  return rec;
}

export function removeServerBuff(id: string): boolean {
  return ACTIVE.delete(id);
}

export function clearAllServerBuffs(): void {
  ACTIVE.clear();
}

export function syncServerBuffsToConnectedPlayers(
  entities: EntityManager,
  sessions: SessionManager,
  nowMs: number = Date.now(),
): { applied: number; removedExpired: number } {
  // Remove expired server buffs first.
  let removedExpired = 0;
  for (const [id, b] of [...ACTIVE.entries()]) {
    if (b.expiresAtMs !== Number.MAX_SAFE_INTEGER && b.expiresAtMs <= nowMs) {
      ACTIVE.delete(id);
      removedExpired++;
    }
  }

  const buffs = [...ACTIVE.values()];
  if (buffs.length === 0) return { applied: 0, removedExpired };

  let applied = 0;

  for (const s of sessions.getAllSessions()) {
    const char = (s as Session)?.character as CharacterState | undefined;
    if (!char) continue;

    // The character might be connected without an entity yet in some tests;
    // server buffs live on CharacterState progression, so that's fine.
    const active = getActiveStatusEffects(char, nowMs);
    const activeIds = new Set(active.map((e) => e.id));

    for (const b of buffs) {
      if (activeIds.has(b.effectId)) continue;

      const durationMs =
        b.expiresAtMs === Number.MAX_SAFE_INTEGER
          ? -1
          : Math.max(0, b.expiresAtMs - nowMs);

      const input: NewStatusEffectInput = {
        id: b.effectId,
        sourceKind: b.sourceKind,
        sourceId: b.sourceId,
        name: b.name ?? b.id,
        durationMs,
        modifiers: b.modifiers,
        tags: b.tags ?? ["server"],
        maxStacks: b.maxStacks,
        initialStacks: b.initialStacks,
        appliedByKind: "system",
        appliedById: "server",
      };

      applyStatusEffect(char, input, nowMs);
      applied++;
    }
  }

  return { applied, removedExpired };
}

export function clearServerBuffFromConnectedPlayers(
  sessions: SessionManager,
  id: string,
): number {
  const effectId = toEffectId(id);
  let cleared = 0;
  for (const s of sessions.getAllSessions()) {
    const char = (s as Session)?.character as CharacterState | undefined;
    if (!char) continue;
    const before = getActiveStatusEffects(char).length;
    clearStatusEffect(char, effectId);
    const after = getActiveStatusEffects(char).length;
    if (after < before) cleared++;
  }
  return cleared;
}
