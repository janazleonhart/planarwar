//worldcore/world/TownSiegeAlarmService.ts

import { WorldEventBus } from "./WorldEventBus";
import type { ServerOpcode } from "../shared/messages";

type RoomLike = {
  broadcast?: (op: ServerOpcode, payload?: any) => void;
};

function envInt(name: string, defaultValue: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

function parseRoomCoord(roomId: string): { shard: string; x: number; z: number } | null {
  // Expected: "shard:x,z" (e.g. prime_shard:0,0)
  const raw = String(roomId || "");
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const shard = raw.slice(0, idx);
  const rest = raw.slice(idx + 1);
  const parts = rest.split(",");
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const z = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { shard, x, z };
}

function formatRoomCoord(coord: { shard: string; x: number; z: number }): string {
  return `${coord.shard}:${coord.x},${coord.z}`;
}

/**
 * TownSiegeAlarmService
 *
 * Listens for town.sanctuary.siege events and broadcasts a diegetic warning to the
 * town room (and optionally neighboring rooms).
 *
 * This is intentionally lightweight: it's a UX/story hook for MUD players and
 * future UI, not a full invasion system.
 */
export class TownSiegeAlarmService {
  private readonly rooms: { get: (roomId: string) => RoomLike | undefined };

  private readonly rangeTiles: number;
  private readonly cooldownMs: number;

  private lastAlarmAtByRoomId = new Map<string, number>();

  constructor(
    events: WorldEventBus,
    rooms: { get: (roomId: string) => RoomLike | undefined },
  ) {
    this.rooms = rooms;
    this.rangeTiles = Math.max(0, envInt("PW_TOWN_SIEGE_ALARM_RANGE_TILES", 0));
    this.cooldownMs = Math.max(0, envInt("PW_TOWN_SIEGE_ALARM_COOLDOWN_MS", 15000));

    events.on("town.sanctuary.siege", (p) => {
      try {
        this.onSiege(p.roomId, Date.now());
      } catch {
        // never block event bus
      }
    });
  }

  private onSiege(roomId: string, now: number): void {
    const last = this.lastAlarmAtByRoomId.get(roomId) ?? 0;
    if (this.cooldownMs > 0 && now - last < this.cooldownMs) return;

    const targets = this.expandRoomsInRange(roomId, this.rangeTiles);
    const msg = {
      from: "[alarm]",
      sessionId: "system",
      text: "The town bells ring — enemies mass at the gates!",
      t: now,
    };

    let did = false;
    for (const rid of targets) {
      const room = this.rooms.get(rid);
      if (!room?.broadcast) continue;
      try {
        room.broadcast("chat", msg);
        did = true;
      } catch {
        // ignore
      }
    }

    if (did) this.lastAlarmAtByRoomId.set(roomId, now);
  }

  private expandRoomsInRange(centerRoomId: string, rangeTiles: number): string[] {
    if (rangeTiles <= 0) return [centerRoomId];

    const c = parseRoomCoord(centerRoomId);
    if (!c) return [centerRoomId];

    const out: string[] = [];
    for (let dx = -rangeTiles; dx <= rangeTiles; dx++) {
      for (let dz = -rangeTiles; dz <= rangeTiles; dz++) {
        // Chebyshev distance (matches your tile policies elsewhere)
        if (Math.max(Math.abs(dx), Math.abs(dz)) > rangeTiles) continue;
        out.push(formatRoomCoord({ shard: c.shard, x: c.x + dx, z: c.z + dz }));
      }
    }
    return out;
  }
}
