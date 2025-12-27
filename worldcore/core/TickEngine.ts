// worldcore/core/TickEngine.ts

import { EntityManager } from "./EntityManager";
import { RoomManager } from "./RoomManager";
import { SessionManager } from "./SessionManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { Logger } from "../utils/logger";
import { NpcManager } from "../npc/NpcManager";

export interface TickEngineConfig {
  intervalMs: number; // tick interval (e.g. 50ms for 20 TPS)

  /**
   * Optional hook invoked once per tick with:
   *  - nowMs: Date.now() for this tick
   *  - tick: current tick count (starting at 1)
   *  - deltaMs: elapsed time since previous tick (ms)
   *
   * Existing handlers that only take (nowMs) or (nowMs, tick)
   * will still type-check because deltaMs is optional.
   */
  onTick?: (nowMs: number, tick: number, deltaMs?: number) => void;
}

/**
 * TickEngine v1.1
 *
 * For now it:
 *  - ticks on a fixed interval
 *  - runs NPC update ticks (NpcManager.updateAll)
 *  - calls an onTick hook for things like SongEngine
 *  - logs basic room/session stats every N ticks
 */
export class TickEngine {
  private readonly log = Logger.scope("TICK");
  private readonly intervalMs: number;
  private readonly cfg: TickEngineConfig;

  private running = false;
  private handle: NodeJS.Timeout | null = null;
  private tickCount = 0;

  private lastTickAt: number | null = null;

  constructor(
    private readonly entities: EntityManager,
    private readonly rooms: RoomManager,
    private readonly sessions: SessionManager,
    private readonly world: ServerWorldManager,
    cfg: TickEngineConfig,
    private readonly npcs?: NpcManager
  ) {
    this.cfg = cfg;
    this.intervalMs = Math.max(cfg.intervalMs, 10);
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.lastTickAt = Date.now();

    this.log.info("Starting TickEngine", {
      intervalMs: this.intervalMs,
    });

    this.handle = setInterval(() => this.tick(), this.intervalMs);
    this.handle.unref?.();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }

    this.log.info("TickEngine stopped", {
      lastTick: this.tickCount,
    });
  }

  private tick(): void {
    if (!this.running) return;

    this.tickCount++;

    const now = Date.now();
    const deltaMs =
      this.lastTickAt !== null ? now - this.lastTickAt : this.intervalMs;
    this.lastTickAt = now;

    // NPCs get a chance to think each tick.
    if (this.npcs) {
      try {
        this.npcs.updateAll(deltaMs, this.sessions);
      } catch (err: any) {
        this.log.warn("Error during NpcManager.updateAll", {
          error: String(err),
        });
      }
    }

    // Global hook for systems that want a heartbeat (SongEngine, etc.)
    try {
      this.cfg.onTick?.(now, this.tickCount, deltaMs);
    } catch (err: any) {
      this.log.warn("Error in TickEngine onTick hook", {
        error: String(err),
      });
    }

    // Basic metrics
    let roomCount = 0;
    for (const _ of this.rooms.listRooms()) {
      roomCount++;
    }

    const sessionCount = this.sessions.count();
    const entityCount = this.entities.getAll().length;

    if (this.tickCount % 20 === 0) {
      this.log.debug("Tick summary", {
        tick: this.tickCount,
        rooms: roomCount,
        sessions: sessionCount,
        entities: entityCount,
        worldId: this.world.getWorldBlueprint().id,
        deltaMs,
      });
    }
  }
}
