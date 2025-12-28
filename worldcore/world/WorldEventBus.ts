// worldcore/world/WorldEventBus.ts
// ------------------------------------------------------------
// Purpose:
// Provides a centralized publish–subscribe (event bus) system
// for communication between world managers and services.
// Enables decoupled handling of world events such as spawning,
// movement, combat, law enforcement, and respawns.
//
// The EventBus supports both synchronous and async handlers,
// ensuring flexibility across AI, world, and MMO systems.
// ------------------------------------------------------------

import { Logger } from "../utils/logger";

const log = Logger.scope("EVENT");

// ------------------------------------------------------------
// Event Types
// ------------------------------------------------------------

export type WorldEvent =
  | "entity.spawned"
  | "entity.despawned"
  | "entity.moved"
  | "region.changed"
  | "room.entered"
  | "room.exited"
  | "npc.aggressed"
  | "npc.died"
  | "player.connected"
  | "player.disconnected"
  | "law.crime"
  | "weather.changed";

export type WorldEventPayloads = {
  "entity.spawned": { entityId: string; roomId: string; regionId?: string };
  "entity.despawned": { entityId: string; reason?: string };
  "entity.moved": { entityId: string; fromRoomId: string; toRoomId: string };
  "region.changed": { entityId: string; fromRegion?: string; toRegion?: string };
  "room.entered": { entityId: string; roomId: string };
  "room.exited": { entityId: string; roomId: string };
  "npc.aggressed": { npcId: string; targetId: string };
  "npc.died": { npcId: string; killerId?: string };
  "player.connected": { sessionId: string };
  "player.disconnected": { sessionId: string };
  "law.crime": { actorId: string; crimeType: string; regionId: string };
  "weather.changed": { regionId: string; weather: string };
};

type EventHandler<K extends WorldEvent> = (
  payload: WorldEventPayloads[K],
) => void | Promise<void>;

// ------------------------------------------------------------
// WorldEventBus
// ------------------------------------------------------------

export class WorldEventBus {
  private handlers: Map<WorldEvent, Set<EventHandler<any>>> = new Map();

  on<K extends WorldEvent>(event: K, handler: EventHandler<K>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    log.debug(`Handler registered for event: ${event}`);
  }

  off<K extends WorldEvent>(event: K, handler: EventHandler<K>): void {
    this.handlers.get(event)?.delete(handler);
    log.debug(`Handler removed for event: ${event}`);
  }

  emit<K extends WorldEvent>(event: K, payload: WorldEventPayloads[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    log.debug(`Emitting event: ${event}`);
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        log.error(`Handler error on event ${event}`, err);
      }
    }
  }

  async emitAsync<K extends WorldEvent>(
    event: K,
    payload: WorldEventPayloads[K],
  ): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    log.debug(`Emitting async event: ${event}`);
    for (const handler of set) {
      try {
        await handler(payload);
      } catch (err) {
        log.error(`Async handler error on event ${event}`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
    log.warn("All event handlers cleared from WorldEventBus.");
  }
}
