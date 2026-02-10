// worldcore/world/TownSiegeService.ts

import { WorldEventBus } from "./WorldEventBus";

export type TownSiegeTier = "warning" | "siege" | "breach" | "recovery";

export type TownSiegeState = {
  shardId: string;
  roomId: string;

  lastPressureCount: number;
  lastWindowMs: number;
  lastEventTs: number;

  /** While now < warningUntilTs, the town is in 'warning' tier. */
  warningUntilTs: number;

  /** While now < siegeUntilTs, the town is considered under siege (warning is a sub-tier of this). */
  siegeUntilTs: number;

  /** Optional breach window: while active, sanctuary boundary may be lifted (opt-in per region). */
  breachUntilTs?: number;

  /** After siege ends, keep a short-lived 'recovery' tier so systems can react (alarm cool-down, economy reopen, etc.). */
  recoveryUntilTs: number;

  /** Count of siege triggers observed in the current breach rolling window (debug/inspection). */
  breachCountInWindow: number;
};

export type TownSiegeDebugState = {
  tier: TownSiegeTier | "none";
  nowMs: number;

  warningLeftMs: number;
  siegeLeftMs: number;
  breachLeftMs: number;
  recoveryLeftMs: number;

  breachCountInWindow: number;
  breachHitsRequired: number;
  breachWindowMs: number;
  breachTtlMs: number;

  lastPressureCount: number;
  lastWindowMs: number;
  lastEventAgeMs: number;
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

function readWarningMs(): number {
  // Short early stage to let UI/guards react before the 'siege' tier.
  return envInt("PW_TOWN_SIEGE_WARNING_MS", 8000);
}

function readRecoveryMs(): number {
  // Recovery persists briefly after the siege ends, so systems can "cool down" gracefully.
  return envInt("PW_TOWN_SIEGE_RECOVERY_MS", 15000);
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

type BreachRecord = { breachUntilTs: number | null; breachCountInWindow: number };

export class TownSiegeService {
  private readonly siegeTtlMs: number;
  private readonly warningMs: number;
  private readonly recoveryMs: number;

  private readonly breachTtlMs: number;
  private readonly breachHits: number;
  private readonly breachWindowMs: number;

  private readonly stateByRoomId: Map<string, TownSiegeState> = new Map();
  private readonly breachEventTsByRoomId: Map<string, number[]> = new Map();

  constructor(events: WorldEventBus) {
    this.siegeTtlMs = readSiegeTtlMs();
    this.warningMs = readWarningMs();
    this.recoveryMs = readRecoveryMs();

    this.breachTtlMs = readBreachTtlMs();
    this.breachHits = readBreachHits();
    this.breachWindowMs = readBreachWindowMs();

    events.on("town.sanctuary.siege", (p) => {
      const now = Date.now();

      const warningUntilTs = now + this.warningMs;
      const siegeUntilTs = now + this.siegeTtlMs;
      const recoveryUntilTs = siegeUntilTs + this.recoveryMs;

      const breachRec = this.maybeRecordBreach(p.roomId, now);
      const breachUntilTs = breachRec.breachUntilTs ?? undefined;

      this.stateByRoomId.set(p.roomId, {
        shardId: p.shardId,
        roomId: p.roomId,

        lastPressureCount: p.pressureCount,
        lastWindowMs: p.windowMs,
        lastEventTs: now,

        warningUntilTs,
        siegeUntilTs,
        breachUntilTs,

        recoveryUntilTs,

        breachCountInWindow: breachRec.breachCountInWindow,
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

  private maybeRecordBreach(roomId: string, nowMs: number): BreachRecord {
    // Single-hit breach is allowed (useful for tests/dev).
    if (this.breachHits <= 1) {
      return { breachUntilTs: nowMs + this.breachTtlMs, breachCountInWindow: 1 };
    }

    const arr = this.breachEventTsByRoomId.get(roomId) ?? [];
    const cutoff = nowMs - this.breachWindowMs;
    const kept = arr.filter((t) => t >= cutoff);
    kept.push(nowMs);
    this.breachEventTsByRoomId.set(roomId, kept);

    if (kept.length >= this.breachHits) {
      // Reset counter so repeated events don't instantly re-breach forever.
      this.breachEventTsByRoomId.set(roomId, []);
      return { breachUntilTs: nowMs + this.breachTtlMs, breachCountInWindow: kept.length };
    }

    return { breachUntilTs: null, breachCountInWindow: kept.length };
  }

  /** Returns state while a town is in siege OR recovery. */
  getSiegeState(roomId: string, nowMs = Date.now()): TownSiegeState | null {
    const st = this.stateByRoomId.get(roomId);
    if (!st) return null;

    // Expire when recovery ends.
    if (nowMs > st.recoveryUntilTs) {
      this.stateByRoomId.delete(roomId);
      return null;
    }

    return st;
  }

  getTier(roomId: string, nowMs = Date.now()): TownSiegeTier | "none" {
    const st = this.getSiegeState(roomId, nowMs);
    if (!st) return "none";

    const breachUntil = st.breachUntilTs ?? 0;
    if (breachUntil > nowMs) return "breach";

    if (nowMs < st.siegeUntilTs) {
      if (nowMs < st.warningUntilTs) return "warning";
      return "siege";
    }

    if (nowMs < st.recoveryUntilTs) return "recovery";
    return "none";
  }

  isBreachActive(roomId: string, nowMs = Date.now()): boolean {
    return this.getTier(roomId, nowMs) === "breach";
  }

  isUnderSiege(roomId: string, nowMs = Date.now()): boolean {
    const st = this.getSiegeState(roomId, nowMs);
    return !!st && nowMs < st.siegeUntilTs;
  }

  /** Compact, stable, machine-readable debug state for MUD/UI tools. */
  getDebugState(roomId: string, nowMs = Date.now()): TownSiegeDebugState {
    const st = this.getSiegeState(roomId, nowMs);

    if (!st) {
      return {
        tier: "none",
        nowMs,

        warningLeftMs: 0,
        siegeLeftMs: 0,
        breachLeftMs: 0,
        recoveryLeftMs: 0,

        breachCountInWindow: 0,
        breachHitsRequired: this.breachHits,
        breachWindowMs: this.breachWindowMs,
        breachTtlMs: this.breachTtlMs,

        lastPressureCount: 0,
        lastWindowMs: 0,
        lastEventAgeMs: 0,
      };
    }

    const tier = this.getTier(roomId, nowMs);
    const warningLeftMs = Math.max(0, st.warningUntilTs - nowMs);
    const siegeLeftMs = Math.max(0, st.siegeUntilTs - nowMs);
    const breachLeftMs = Math.max(0, Number(st.breachUntilTs ?? 0) - nowMs);
    const recoveryLeftMs = Math.max(0, st.recoveryUntilTs - nowMs);

    return {
      tier,
      nowMs,

      warningLeftMs,
      siegeLeftMs,
      breachLeftMs,
      recoveryLeftMs,

      breachCountInWindow: st.breachCountInWindow,
      breachHitsRequired: this.breachHits,
      breachWindowMs: this.breachWindowMs,
      breachTtlMs: this.breachTtlMs,

      lastPressureCount: st.lastPressureCount,
      lastWindowMs: st.lastWindowMs,
      lastEventAgeMs: Math.max(0, nowMs - st.lastEventTs),
    };
  }

  clear(): void {
    this.stateByRoomId.clear();
    this.breachEventTsByRoomId.clear();
  }
}
