// worldcore/status/ServerEvents.ts
//
// Server Events v0:
// - Loads active server_events + server_event_effects.
// - Materializes `grant_server_buff` effects into persisted server_buffs with source_kind='event'.
// - Revokes previously materialized event-buffs when events become inactive.
//
// NOTE: we intentionally materialize into server_buffs (DB) so the existing ServerBuffs
// pipeline remains the single source of truth for applying buffs to connected players.
//
// Guardrails:
// - Unit tests must remain deterministic and must NOT open DB connections.
// - Sync is best-effort; failures log and do not crash TickEngine.

import { Logger } from "../utils/logger";
import type { EntityManager } from "../core/EntityManager";
import type { SessionManager } from "../core/SessionManager";
import { PostgresServerEventService, ActiveServerEvent } from "./PostgresServerEventService";
import { PostgresServerBuffService, PersistedServerBuffRow } from "./PostgresServerBuffService";

type GrantServerBuffPayload = {
  id: string;
  name?: string;
  modifiers?: any;
  tags?: string[];
  maxStacks?: number;
  initialStacks?: number;
  /** optional: override effect id; default is server_buff:<id> */
  effectId?: string;
};

const log = Logger.scope("SERVER_EVENTS");

/**
 * Runtime cache is intentionally minimal. We keep it only to allow a debug
 * "reset" that forces a full DB reconcile on next tick.
 *
 * In practice we *also* reconcile against the DB, so a restart doesn't leak buffs.
 */
let forceFullReconcile = false;

/**
 * Reset runtime cache (useful for hot reload / debug tooling).
 */
export function resetServerEventsRuntimeCache(): void {
  forceFullReconcile = true;
}

function effectIdFor(payload: GrantServerBuffPayload): string {
  if (payload.effectId && String(payload.effectId).trim()) return String(payload.effectId).trim();
  return `server_buff:${payload.id}`;
}

function keyFor(eventId: string, buffId: string): string {
  return `${eventId}::${buffId}`;
}

function parseEventEndsAtMs(event: ActiveServerEvent): number | null {
  if (!event.ends_at) return null;
  const ms = Date.parse(event.ends_at);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Core sync: reconcile active events -> persisted server_buffs.
 *
 * Returns a short status string for debug tooling.
 */
export async function syncServerEventsToPersistence(nowMs: number = Date.now()): Promise<string> {
  const evSvc = new PostgresServerEventService();
  const buffSvc = new PostgresServerBuffService();

  const activeEvents = await evSvc.listActive(nowMs);

  // Desired event-buff keys
  const desiredKeys = new Set<string>();
  let upserts = 0;

  for (const event of activeEvents) {
    const expiresAtMs = parseEventEndsAtMs(event);

    for (const eff of event.effects) {
      if (String(eff.effect_kind) !== "grant_server_buff") continue;

      const payload = (eff.payload ?? {}) as GrantServerBuffPayload;
      const buffId = String(payload.id ?? "").trim();
      if (!buffId) continue;

      desiredKeys.add(keyFor(event.id, buffId));

      await buffSvc.upsert({
        id: buffId,
        name: payload.name ?? event.name ?? null,
        effectId: effectIdFor(payload),
        appliedAtMs: nowMs,
        expiresAtMs,
        sourceKind: "event",
        sourceId: event.id,
        modifiers: payload.modifiers ?? {},
        tags: payload.tags ?? ["server", "event"],
        maxStacks: payload.maxStacks ?? null,
        initialStacks: payload.initialStacks ?? null,
        createdBy: event.updated_by ?? null,
      });

      upserts++;
    }
  }

  // Reconcile previously materialized event buffs by scanning active persisted buffs.
  // This prevents "ghost buffs" after restart or hot reload.
  let revokes = 0;
  if (forceFullReconcile || desiredKeys.size > 0) {
    const persisted = await buffSvc.listActive(nowMs);
    for (const row of persisted) {
      if (String(row.source_kind) !== "event") continue;

      const k = keyFor(String(row.source_id ?? ""), row.id);
      if (desiredKeys.has(k)) continue;

      // Revoke; record records are shared, so keep revokedBy small.
      await buffSvc.revoke(row.id, `event:${row.source_id}`, nowMs);
      revokes++;
    }
  }

  forceFullReconcile = false;

  return `serverEvents sync ok: activeEvents=${activeEvents.length} upserts=${upserts} revokes=${revokes}`;
}

/**
 * TickEngine-facing API: matches the signature style of other tick helpers.
 * Entities/sessions are currently unused, but kept for consistency and future hooks.
 */
export async function syncServerEventsToRuntime(
  _entities: EntityManager,
  _sessions: SessionManager,
  nowMs: number,
): Promise<void> {
  try {
    const syncEvery = Number(process.env.PW_SERVER_EVENTS_SYNC_MS ?? "5000");
    const minEvery = 250;
    const everyMs = Number.isFinite(syncEvery) ? Math.max(minEvery, syncEvery) : 5000;

    // Cheap rate-limit based on nowMs modulus. Deterministic and no timers.
    if (nowMs % everyMs > 50) return;

    const msg = await syncServerEventsToPersistence(nowMs);
    log.debug(msg);
  } catch (err: any) {
    log.warn("syncServerEventsToRuntime failed", { error: String(err?.message ?? err) });
  }
}
