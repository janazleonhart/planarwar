// worldcore/world/TownSiegeService.ts

import { WorldEventBus } from "./WorldEventBus";

export type TownSiegeState = {
  shardId: string;
  roomId: string;
  lastPressureCount: number;
  lastWindowMs: number;
  lastEventTs: number;
  untilTs: number;
  /** Optional breach window: while active, sanctuary boundary may be lifted (opt-in per region). */
  breachUntilTs?: number;
  /** Number of siege triggers counted toward breach (debug/inspection). */
  breachCount?: number;
};

function envInt(name: string, defaultValue: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

function readSiegeTtlMs(): number {
  // 60s default: long enough to matter, short enough to clear on its own.
  return envInt("PW_TOWN_SANCTUARY_SIEGE_TTL_MS", 60000);
}

function readBreachTtlMs(): number {
  // 20s default: breach is dramatic, but should self-heal quickly.
  return envInt("PW_TOWN_SIEGE_BREACH_TTL_MS", 20000);
}

function readBreachHits(): number {
  // Require multiple pressure-triggered siege events before we declare a breach.
  return Math.max(1, envInt("PW_TOWN_SIEGE_BREACH_HITS", 3));
}

function readBreachWindowMs(): number {
  // Rolling window for breach escalation.
  return envInt("PW_TOWN_SIEGE_BREACH_WINDOW_MS", 30000);
}

export class TownSiegeService {
  private readonly ttlMs: number;
  private readonly breachTtlMs: number;
  private readonly breachHits: number;
  private readonly breachWindowMs: number;
  private readonly stateByRoomId: Map<string, TownSiegeState> = new Map();
  private readonly breachEventTsByRoomId: Map<string, number[]> = new Map();

  constructor(events: WorldEventBus) {
    this.ttlMs = readSiegeTtlMs();
    this.breachTtlMs = readBreachTtlMs();
    this.breachHits = readBreachHits();
    this.breachWindowMs = readBreachWindowMs();

    events.on("town.sanctuary.siege", (p) => {
      const now = Date.now();
      const untilTs = now + this.ttlMs;

      // Breach escalation: count recent siege triggers; if enough, mark breach window.
      const breachUntilTs = this.maybeRecordBreach(p.roomId, now);

      this.stateByRoomId.set(p.roomId, {
        shardId: p.shardId,
        roomId: p.roomId,
        lastPressureCount: p.pressureCount,
        lastWindowMs: p.windowMs,
        lastEventTs: now,
        untilTs,
        breachUntilTs: breachUntilTs ?? undefined,
        breachCount: breachUntilTs ? this.breachHits : undefined,
      });

      if (breachUntilTs) {
        events.emit("town.sanctuary.breach", {
          shardId: p.shardId,
          roomId: p.roomId,
          breachUntilTs,
        });
      }
    });
  }

  private maybeRecordBreach(roomId: string, nowMs: number): number | null {
    if (this.breachHits <= 1) return nowMs + this.breachTtlMs;

    const arr = this.breachEventTsByRoomId.get(roomId) ?? [];
    const cutoff = nowMs - this.breachWindowMs;
    const kept = arr.filter((t) => t >= cutoff);
    kept.push(nowMs);
    this.breachEventTsByRoomId.set(roomId, kept);

    if (kept.length >= this.breachHits) {
      // Reset counter so repeated events don't instantly re-breach forever.
      this.breachEventTsByRoomId.set(roomId, []);
      return nowMs + this.breachTtlMs;
    }
    return null;
  }

  getSiegeState(roomId: string, nowMs = Date.now()): TownSiegeState | null {
    const st = this.stateByRoomId.get(roomId);
    if (!st) return null;
    if (nowMs > st.untilTs) {
      this.stateByRoomId.delete(roomId);
      return null;
    }
    return st;
  }

  isBreachActive(roomId: string, nowMs = Date.now()): boolean {
    const st = this.getSiegeState(roomId, nowMs);
    if (!st) return false;
    const until = st.breachUntilTs ?? 0;
    return until > nowMs;
  }

  isUnderSiege(roomId: string, nowMs = Date.now()): boolean {
    return this.getSiegeState(roomId, nowMs) !== null;
  }

  clear(): void {
    this.stateByRoomId.clear();
    this.breachEventTsByRoomId.clear();
  }
}
