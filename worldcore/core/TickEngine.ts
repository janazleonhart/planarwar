// worldcore/core/TickEngine.ts

import { EntityManager } from "./EntityManager";
import { RoomManager } from "./RoomManager";
import { SessionManager } from "./SessionManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { Logger } from "../utils/logger";

export interface TickEngineConfig {
  intervalMs: number; // tick interval (e.g. 50ms for 20 TPS)

  /**
   * Optional hook invoked once per tick with:
   *  - nowMs: Date.now() for this tick
   *  - tick:  current tick count (starting at 1)
   *
   * You can use this for:
   *  - SongEngine ticks
   *  - AI updates
   *  - World events
   */
  onTick?: (nowMs: number, tick: number) => void;
}

/**
 * TickEngine v1
 *
 * For now it:
 *  - ticks on a fixed interval
 *  - logs basic room/session stats every N ticks
 *
 * Later, we’ll add:
 *  - server-side movement reconciliation
 *  - AI updates
 *  - world events
 */
export class TickEngine {
  private readonly log = Logger.scope("TICK");
  private readonly intervalMs: number;
  private readonly cfg: TickEngineConfig;

  private running = false;
  private handle: NodeJS.Timeout | null = null;
  private tickCount = 0;

  constructor(
    private readonly entities: EntityManager,
    private readonly rooms: RoomManager,
    private readonly sessions: SessionManager,
    private readonly world: ServerWorldManager,
    cfg: TickEngineConfig
  ) {
    this.cfg = cfg;
    this.intervalMs = Math.max(cfg.intervalMs, 10);
  }

  start(): void {
    if (this.running) return;

    this.running = true;
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

    // Global hook for systems that want a heartbeat (SongEngine, AI, etc.)
    try {
      this.cfg.onTick?.(now, this.tickCount);
    } catch (err: any) {
      this.log.warn("Error in TickEngine onTick hook", {
        error: String(err),
      });
    }

    // For now we just gather basic metrics.
    let roomCount = 0;
    for (const _ of this.rooms.listRooms()) {
      roomCount++;
    }

    const sessionCount = this.sessions.count();
    const entityCount = this.entities.getAll().length;

    // Light debug every N ticks so we don't drown in logs
    if (this.tickCount % 20 === 0) {
      this.log.debug("Tick summary", {
        tick: this.tickCount,
        rooms: roomCount,
        sessions: sessionCount,
        entities: entityCount,
        worldId: this.world.getWorldBlueprint().id,
      });
    }
  }
}
