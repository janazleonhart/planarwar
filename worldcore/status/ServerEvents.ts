// worldcore/status/ServerEvents.ts
//
// Server Events v0:
// - Loads active server_events + server_event_effects.
// - Materializes `grant_server_buff` effects into persisted server_buffs with source_kind='event'.
// - Applies small, safe, event-scoped side effects:
//    - `set_server_kv`: writes keys under `event.<eventId>.<key>`
//    - `broadcast_message`: sends a one-shot message on activation
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
import { PostgresServerBuffService } from "./PostgresServerBuffService";
import { PostgresServerKvService } from "./PostgresServerKvService";

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

type SetServerKvPayload = {
  /** A short key name; stored as event.<eventId>.<key> */
  key: string;
  value: any;
};

type BroadcastMessagePayload = {
  text: string;
  /** defaults true */
  oncePerActivation?: boolean;
  /** optional prefix override */
  prefix?: string;
};

const log = Logger.scope("SERVER_EVENTS");

/**
 * Runtime cache is intentionally minimal. We keep it only to allow a debug
 * "reset" that forces a full DB reconcile on next tick.
 */
let forceFullReconcile = false;

/**
 * Broadcast cache: effectKey -> seen (for one-shot sends while event remains active).
 * Pruned automatically when events become inactive.
 */
let broadcastedEffectKeys = new Set<string>();

/**
 * Reset runtime cache (useful for hot reload / debug tooling).
 */
export function resetServerEventsRuntimeCache(): void {
  forceFullReconcile = true;
  broadcastedEffectKeys = new Set<string>();
}

function effectIdFor(payload: GrantServerBuffPayload): string {
  if (payload.effectId && String(payload.effectId).trim()) return String(payload.effectId).trim();
  return `server_buff:${payload.id}`;
}

function keyFor(eventId: string, buffId: string): string {
  return `${eventId}::${buffId}`;
}

function broadcastKeyFor(eventId: string, effectRowId: number): string {
  return `${eventId}::fx:${effectRowId}`;
}

function parseEventEndsAtMs(event: ActiveServerEvent): number | null {
  if (!event.ends_at) return null;
  const ms = Date.parse(event.ends_at);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeEventKvToken(s: string): string {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  // Keep it boring and safe: [a-zA-Z0-9._-]
  return raw
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
}

function eventKvKey(eventId: string, key: string): string {
  const eid = normalizeEventKvToken(eventId);
  const k = normalizeEventKvToken(key);
  if (!eid || !k) return "";
  return `event.${eid}.${k}`;
}

async function syncEventKv(activeEvents: ActiveServerEvent[], nowMs: number): Promise<{ upserts: number; deletes: number }> {
  const kvSvc = new PostgresServerKvService();

  const desired = new Set<string>();
  let upserts = 0;

  for (const ev of activeEvents) {
    for (const eff of ev.effects) {
      if (String(eff.effect_kind) !== "set_server_kv") continue;
      const payload = (eff.payload ?? {}) as SetServerKvPayload;
      const k = eventKvKey(ev.id, payload.key);
      if (!k) continue;

      desired.add(k);
      await kvSvc.set(k, payload.value, ev.updated_by ?? null);
      upserts++;
    }
  }

  // Clean up keys under the reserved `event.` namespace that are no longer desired.
  let deletes = 0;
  try {
    const existing = await kvSvc.listKeysByPrefix("event.");
    for (const k of existing) {
      if (desired.has(k)) continue;
      const ok = await kvSvc.delete(k);
      if (ok) deletes++;
    }
  } catch {
    // Best-effort; don't crash tick.
  }

  return { upserts, deletes };
}

function broadcastToAll(sessions: SessionManager, text: string): void {
  const list: any[] = (() => {
    try {
      const sAny: any = sessions as any;
      if (typeof sAny.getAllSessions === "function") return sAny.getAllSessions();
      if (typeof sAny.values === "function") return Array.from(sAny.values());
      return [];
    } catch {
      return [];
    }
  })();

  for (const sess of list) {
    try {
      (sessions as any).send?.(sess, "mud_result", { text });
    } catch {
      // ignore
    }
  }
}

function syncBroadcasts(activeEvents: ActiveServerEvent[], sessions: SessionManager): { sent: number; activeFx: number } {
  const activeKeys = new Set<string>();
  let sent = 0;

  for (const ev of activeEvents) {
    for (const eff of ev.effects) {
      if (String(eff.effect_kind) !== "broadcast_message") continue;
      const payload = (eff.payload ?? {}) as BroadcastMessagePayload;

      const once = payload.oncePerActivation !== false;
      const fxKey = broadcastKeyFor(ev.id, Number(eff.id));
      activeKeys.add(fxKey);

      if (once && broadcastedEffectKeys.has(fxKey)) continue;

      const prefix = String(payload.prefix ?? "[world]").trim() || "[world]";
      const msg = String(payload.text ?? "").trim();
      if (!msg) continue;

      broadcastToAll(sessions, `${prefix} ${msg}`);
      sent++;

      if (once) broadcastedEffectKeys.add(fxKey);
    }
  }

  // Prune cache entries for effects that are no longer active.
  if (broadcastedEffectKeys.size > 0) {
    for (const k of Array.from(broadcastedEffectKeys)) {
      if (!activeKeys.has(k)) broadcastedEffectKeys.delete(k);
    }
  }

  return { sent, activeFx: activeKeys.size };
}

/**
 * Core sync: reconcile active events -> persisted server_buffs + server_kv.
 */
async function syncServerEventsWithActive(activeEvents: ActiveServerEvent[], nowMs: number): Promise<string> {
  const buffSvc = new PostgresServerBuffService();

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
      if (String((row as any).source_kind) !== "event") continue;

      const k = keyFor(String((row as any).source_id ?? ""), (row as any).id);
      if (desiredKeys.has(k)) continue;

      await buffSvc.revoke((row as any).id, `event:${(row as any).source_id}`, nowMs);
      revokes++;
    }
  }

  const kv = await syncEventKv(activeEvents, nowMs);

  forceFullReconcile = false;

  return `serverEvents sync ok: activeEvents=${activeEvents.length} buffUpserts=${upserts} buffRevokes=${revokes} kvUpserts=${kv.upserts} kvDeletes=${kv.deletes}`;
}

/**
 * Core sync: reconcile active events -> persisted server_buffs + server_kv.
 *
 * Returns a short status string for debug tooling.
 */
export async function syncServerEventsToPersistence(nowMs: number = Date.now()): Promise<string> {
  const evSvc = new PostgresServerEventService();
  const activeEvents = await evSvc.listActive(nowMs);
  return syncServerEventsWithActive(activeEvents, nowMs);
}

/**
 * TickEngine-facing API: matches the signature style of other tick helpers.
 */
export async function syncServerEventsToRuntime(
  _entities: EntityManager,
  sessions: SessionManager,
  nowMs: number,
): Promise<void> {
  try {
    const syncEvery = Number(process.env.PW_SERVER_EVENTS_SYNC_MS ?? "5000");
    const minEvery = 250;
    const everyMs = Number.isFinite(syncEvery) ? Math.max(minEvery, syncEvery) : 5000;

    // Cheap rate-limit based on nowMs modulus. Deterministic and no timers.
    if (nowMs % everyMs > 50) return;

    const evSvc = new PostgresServerEventService();
    const activeEvents = await evSvc.listActive(nowMs);

    // 1) persistence reconciliation (server_buffs + server_kv)
    const msg = await syncServerEventsWithActive(activeEvents, nowMs);
    log.debug(msg);

    // 2) ephemeral side effects (broadcast)
    try {
      if (process.env.PW_SERVER_EVENTS_BROADCASTS !== "0") {
        const r = syncBroadcasts(activeEvents, sessions);
        if (r.sent > 0) {
          log.debug("serverEvents broadcast", { sent: r.sent, activeEffects: r.activeFx });
        }
      }
    } catch {
      // ignore
    }
  } catch (err: any) {
    log.warn("syncServerEventsToRuntime failed", { error: String(err?.message ?? err) });
  }
}
