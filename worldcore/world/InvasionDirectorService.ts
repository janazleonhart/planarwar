// worldcore/world/InvasionDirectorService.ts

import { WorldEventBus } from "./WorldEventBus";
import { TownSiegeService } from "./TownSiegeService";

function envInt(name: string, defaultValue: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

/**
 * InvasionDirectorService
 *
 * Purpose:
 * Convert "town is in trouble" signals (siege/breach) into a stable, typed intent event
 * that future systems (Mother Brain spawn writers, UI, scripting) can consume.
 *
 * This is intentionally *not* a spawner. It only emits an intent event.
 */
export class InvasionDirectorService {
  private readonly cooldownMs: number;
  private readonly lastIntentTsByRoomId: Map<string, number> = new Map();

  constructor(
    private readonly events: WorldEventBus,
    private readonly townSiege: TownSiegeService,
  ) {
    this.cooldownMs = envInt("PW_TOWN_INVASION_INTENT_COOLDOWN_MS", 60000);

    events.on("town.sanctuary.breach", (p) => {
      const now = Date.now();
      const last = this.lastIntentTsByRoomId.get(p.roomId) ?? 0;
      if (now - last < this.cooldownMs) return;

      const dbg = this.townSiege.getDebugState(p.roomId);
      const tier = dbg?.tier ?? "breach";

      this.lastIntentTsByRoomId.set(p.roomId, now);
      this.events.emit("town.invasion.intent", {
        shardId: p.shardId,
        roomId: p.roomId,
        reason: "breach",
        tier: tier === "none" ? "breach" : tier,
        ts: now,
      });
    });
  }
}
