// worldcore/core/TickEngine.ts

import { EntityManager } from "./EntityManager";
import { RoomManager } from "./RoomManager";
import { SessionManager } from "./SessionManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { Logger } from "../utils/logger";
import { NpcManager } from "../npc/NpcManager";
import { tickEntityStatusEffectsAndApplyDots } from "../combat/StatusEffects";

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

    
    // NPC status effects + DOTs (periodic damage). This is intentionally best-effort.
    try {
      this.tickNpcStatusDots(now);
    } catch (err: any) {
      this.log.warn("Error during NPC status DOT tick", { error: String(err) });
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
  private tickNpcStatusDots(now: number): void {
    const all = (() => {
      try {
        return this.entities.getAll();
      } catch {
        return [];
      }
    })();

    for (const ent of all as any[]) {
      const type = String((ent as any)?.type ?? (ent as any)?.kind ?? "");
      if (type !== "npc") continue;

      // Corpses should not tick DOTs. (Death clears effects, and tick should be a no-op.)
      const hp = (ent as any)?.hp;
      const alive = (ent as any)?.alive;
      if ((typeof hp === "number" && hp <= 0) || alive === false) continue;

      tickEntityStatusEffectsAndApplyDots(ent as any, now, (amount, meta) => {
        if (!Number.isFinite(amount) || amount <= 0) return;

        // Prefer routing through NpcManager so downstream hooks (aggro/crime/logging) can run.
        const nm: any = this.npcs as any;
        if (nm && typeof nm.applyDamage === "function") {
          try {
            nm.applyDamage((ent as any).id, amount, {
              system: "dot",
              effectId: meta.effectId,
              school: meta.school,
            });
            return;
          } catch {
            // fall through
          }
        }

        // Fallback: mutate the in-memory entity HP directly (tests/dev).
        const hp0 =
          typeof (ent as any).hp === "number"
            ? (ent as any).hp
            : typeof (ent as any).maxHp === "number"
              ? (ent as any).maxHp
              : 0;

        (ent as any).hp = Math.max(0, Math.floor(hp0) - Math.floor(amount));
      });
    }
  }

}
