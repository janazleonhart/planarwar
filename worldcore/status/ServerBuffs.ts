// worldcore/status/ServerBuffs.ts
//
// Server-wide buffs / events / donation perks.
// Uses the same StatusEffects spine as player/NPC buffs.
//
// v1: in-memory runtime map + TickEngine sync to connected players.
// v1.1: optional Postgres persistence (server_buffs) for admin/event-driven buffs.
//
// Guardrails:
// - Unit tests must remain deterministic and must NOT open DB connections.
// - The pure in-memory API used by contracts remains synchronous.

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
import { PostgresServerBuffService } from "./PostgresServerBuffService";

function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

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

function nowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function msUntil(nowMs: number, expiresAtMs: number): number {
  if (expiresAtMs === Number.MAX_SAFE_INTEGER) return -1;
  return Math.max(0, expiresAtMs - nowMs);
}

/**
 * In-memory list of active buffs (prunes expirations).
 */
export function listServerBuffs(nowMs: number = Date.now()): ServerBuffRecord[] {
  // prune expired
  for (const [id, b] of [...ACTIVE.entries()]) {
    if (b.expiresAtMs !== Number.MAX_SAFE_INTEGER && b.expiresAtMs <= nowMs) {
      ACTIVE.delete(id);
    }
  }
  return [...ACTIVE.values()];
}

/**
 * Pure in-memory add (used by contract tests and internal boot wiring).
 */
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

/**
 * Pure in-memory remove.
 */
export function removeServerBuff(id: string): boolean {
  return ACTIVE.delete(id);
}

/**
 * Pure in-memory clear.
 */
export function clearAllServerBuffs(): void {
  ACTIVE.clear();
}

/**
 * Sync all active server buffs to connected players.
 *
 * This is intentionally lightweight and best-effort; TickEngine calls it on heartbeat.
 */
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

      const input: NewStatusEffectInput = {
        id: b.effectId,
        sourceKind: b.sourceKind,
        sourceId: b.sourceId,
        name: b.name ?? b.id,
        durationMs: msUntil(nowMs, b.expiresAtMs),
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

// ---------------------------------------------------------------------------
// Persistence (Postgres)
// ---------------------------------------------------------------------------

const pg = new PostgresServerBuffService();

/**
 * Load persisted buffs into the in-memory ACTIVE map.
 *
 * Safe in unit tests (no-op).
 *
 * Returns: number of buffs loaded.
 */
export async function loadPersistedServerBuffs(nowMs: number = Date.now()): Promise<number> {
  if (isNodeTestRuntime()) return 0;

  const rows = await pg.listActive(nowMs);

  // Replace ACTIVE with the authoritative DB view.
  ACTIVE.clear();

  for (const r of rows) {
    const appliedAtMsRaw = Date.parse(r.applied_at);
    const appliedAtMs = Number.isFinite(appliedAtMsRaw) ? appliedAtMsRaw : nowMs;

    const expiresAtMs = r.expires_at ? Date.parse(r.expires_at) : Number.MAX_SAFE_INTEGER;
    const expires = Number.isFinite(expiresAtMs) ? expiresAtMs : Number.MAX_SAFE_INTEGER;

    const rec: ServerBuffRecord = {
      id: r.id,
      effectId: toEffectId(r.id),
      name: r.name ?? undefined,
      appliedAtMs,
      expiresAtMs: r.expires_at ? expires : Number.MAX_SAFE_INTEGER,
      modifiers: (r.modifiers ?? {}) as any,
      tags: (r.tags ?? undefined) as any,
      sourceKind: (r.source_kind as any) ?? "environment",
      sourceId: r.source_id ?? "server",
      maxStacks: (r.max_stacks ?? undefined) as any,
      initialStacks: (r.initial_stacks ?? undefined) as any,
    };

    ACTIVE.set(rec.id, rec);
  }

  return rows.length;
}

/**
 * Add a buff AND persist it (admin/event path).
 *
 * createdBy is recorded for audit.
 */
export async function addServerBuffPersisted(
  id: string,
  input: Omit<NewStatusEffectInput, "id" | "durationMs"> & {
    durationMs: number;
    name?: string;
    sourceKind?: StatusEffectSourceKind;
    sourceId?: string;
    createdBy?: string | null;
  },
  nowMs: number = Date.now(),
): Promise<ServerBuffRecord> {
  const rec = addServerBuff(id, input, nowMs);

  if (!isNodeTestRuntime()) {
    const expiresAtMs = rec.expiresAtMs === Number.MAX_SAFE_INTEGER ? null : rec.expiresAtMs;

    await pg.upsert({
      id: rec.id,
      name: rec.name ?? null,
      effectId: rec.effectId,
      appliedAtMs: rec.appliedAtMs,
      expiresAtMs,
      sourceKind: rec.sourceKind,
      sourceId: rec.sourceId,
      modifiers: rec.modifiers ?? {},
      tags: rec.tags ?? null,
      maxStacks: rec.maxStacks ?? null,
      initialStacks: rec.initialStacks ?? null,
      createdBy: input.createdBy ?? null,
    });
  }

  return rec;
}

/**
 * Remove a buff from memory and revoke it in DB.
 */
export async function removeServerBuffPersisted(
  id: string,
  revokedBy?: string | null,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const existed = removeServerBuff(id);
  if (!isNodeTestRuntime()) {
    const revoked = await pg.revoke(id, revokedBy ?? null, nowMs);
    return existed || revoked;
  }
  return existed;
}

/**
 * Clear ALL buffs from memory and revoke all in DB.
 */
export async function clearAllServerBuffsPersisted(
  revokedBy?: string | null,
  nowMs: number = Date.now(),
): Promise<number> {
  clearAllServerBuffs();
  if (isNodeTestRuntime()) return 0;
  return await pg.revokeAll(revokedBy ?? null, nowMs);
}

/**
 * Read-only helper for pretty-printing.
 */
export function formatServerBuffLine(b: ServerBuffRecord, nowMs: number): string {
  const expires = b.expiresAtMs === Number.MAX_SAFE_INTEGER ? "(until removed)" : nowIso(b.expiresAtMs);
  const durMs = msUntil(nowMs, b.expiresAtMs);
  const dur = durMs < 0 ? "∞" : `${Math.ceil(durMs / 1000)}s`;
  const tags = (b.tags ?? []).length ? ` tags=${(b.tags ?? []).join(",")}` : "";

  return `${b.id} name='${b.name ?? b.id}' expires=${expires} remaining=${dur} source=${b.sourceKind}:${b.sourceId}${tags}`;
}
