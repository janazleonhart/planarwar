// worldcore/world/TownSiegeService.ts

import { WorldEventBus } from "./WorldEventBus";

export type TownSiegeState = {
  shardId: string;
  roomId: string;
  lastPressureCount: number;
  lastWindowMs: number;
  lastEventTs: number;
  untilTs: number;
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

export class TownSiegeService {
  private readonly ttlMs: number;
  private readonly stateByRoomId: Map<string, TownSiegeState> = new Map();

  constructor(events: WorldEventBus) {
    this.ttlMs = readSiegeTtlMs();

    events.on("town.sanctuary.siege", (p) => {
      const now = Date.now();
      const untilTs = now + this.ttlMs;

      this.stateByRoomId.set(p.roomId, {
        shardId: p.shardId,
        roomId: p.roomId,
        lastPressureCount: p.pressureCount,
        lastWindowMs: p.windowMs,
        lastEventTs: now,
        untilTs,
      });
    });
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

  isUnderSiege(roomId: string, nowMs = Date.now()): boolean {
    return this.getSiegeState(roomId, nowMs) !== null;
  }

  clear(): void {
    this.stateByRoomId.clear();
  }
}
