// worldcore/world/WorldEventJournalService.ts

import { Logger } from "../utils/logger";
import type { WorldEvent, WorldEventPayloads } from "./WorldEventBus";
import { WorldEventBus } from "./WorldEventBus";

const log = Logger.scope("EVENTJ");

export type WorldEventJournalRecord = {
  id: number;
  ts: number;
  event: WorldEvent;
  payload: WorldEventPayloads[WorldEvent];
};

export type WorldEventJournalQuery = {
  sinceTs?: number;
  /** Match events by prefix, e.g. "town." */
  eventPrefix?: string;
  /** Match only these specific events. */
  events?: WorldEvent[];
  /** Max records to return, newest-first. */
  limit?: number;
};

function envInt(name: string, defaultValue: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : defaultValue;
}

/**
 * In-memory append-only journal of world events.
 *
 * Purpose:
 * - A stable handoff surface for future Mother Brain-style systems.
 * - Deterministic introspection in tests and debugging (without log scraping).
 *
 * This service intentionally does not persist to DB yet.
 */
export class WorldEventJournalService {
  private readonly maxRecords: number;
  private nextId = 1;
  private records: WorldEventJournalRecord[] = [];

  private static readonly ALL_EVENTS: WorldEvent[] = [
    "entity.spawned",
    "entity.despawned",
    "entity.moved",
    "region.changed",
    "room.entered",
    "room.exited",
    "npc.aggressed",
    "npc.died",
    "player.connected",
    "player.disconnected",
    "law.crime",
    "weather.changed",
    "town.sanctuary.siege",
    "town.sanctuary.breach",
    "town.invasion.intent",
  ];

  constructor(events: WorldEventBus) {
    // Allow small caps in tests; clamp only to a sensible minimum of 1.
    this.maxRecords = Math.max(1, envInt("PW_WORLD_EVENT_JOURNAL_MAX", 200));

    for (const ev of WorldEventJournalService.ALL_EVENTS) {
      events.on(ev, (payload: any) => {
        this.append(ev, payload as any);
      });
    }

    log.info(`WorldEventJournalService enabled (max=${this.maxRecords}).`);
  }

  append<K extends WorldEvent>(
    event: K,
    payload: WorldEventPayloads[K],
    ts = Date.now(),
  ): void {
    const rec: WorldEventJournalRecord = {
      id: this.nextId++,
      ts,
      event,
      payload: payload as any,
    };

    this.records.push(rec);

    const overflow = this.records.length - this.maxRecords;
    if (overflow > 0) this.records.splice(0, overflow);
  }

  /** Returns newest-first records matching the query. */
  peekRecent(query: WorldEventJournalQuery = {}): WorldEventJournalRecord[] {
    const limit = Math.max(1, Math.min(1000, query.limit ?? 50));
    const sinceTs = query.sinceTs ?? 0;
    const prefix = (query.eventPrefix ?? "").trim();
    const onlyEvents =
      query.events && query.events.length > 0 ? new Set(query.events) : null;

    const out: WorldEventJournalRecord[] = [];
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r.ts < sinceTs) continue;
      if (onlyEvents && !onlyEvents.has(r.event)) continue;
      if (prefix && !r.event.startsWith(prefix)) continue;
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  clear(): void {
    this.records = [];
    this.nextId = 1;
  }
}
