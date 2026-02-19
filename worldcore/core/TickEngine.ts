// worldcore/core/TickEngine.ts

import { EntityManager } from "./EntityManager";
import { RoomManager } from "./RoomManager";
import { SessionManager } from "./SessionManager";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { Logger } from "../utils/logger";
import { NpcManager } from "../npc/NpcManager";
import { tickEntityStatusEffectsAndApplyDots } from "../combat/StatusEffects";
import { formatWorldSpellDotTickLine } from "../combat/CombatLog";
import { tickAllPlayerHots } from "../combat/PlayerHotTicker";
import { pruneAllConnectedPlayerStatuses } from "../status/StatusRuntime";
import { syncServerBuffsToConnectedPlayers } from "../status/ServerBuffs";
import { syncServerEventsToRuntime } from "../status/ServerEvents";

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

    // Player status spine maintenance (prune expirations, clamp stacks).
    // This ensures out-of-combat buffs/debuffs expire even when no periodic payload exists.
    try {
      if (process.env.PW_TICK_PLAYER_STATUS !== "0") {
        pruneAllConnectedPlayerStatuses(this.entities, this.sessions, now);
      }
    } catch (err: any) {
      this.log.warn("Error during player status prune tick", { error: String(err) });
    }

    // Player HOTs (periodic healing) should tick in the canonical heartbeat.
    // This enables out-of-combat regeneration effects without requiring combat loop glue.
    try {
      if (process.env.PW_TICK_PLAYER_HOTS !== "0") {
        tickAllPlayerHots(this.entities, this.sessions, now, this.npcs as any);
      }
    } catch (err: any) {
      this.log.warn("Error during player HOT tick", { error: String(err) });
    }

    // Server Events (scheduled envelopes) should materialize into persisted server buffs.
    // This is intentionally best-effort and rate-limited.
    try {
      if (process.env.PW_TICK_SERVER_EVENTS !== "0") {
        void syncServerEventsToRuntime(this.entities, this.sessions, now);
      }
    } catch (err: any) {
      this.log.warn("Error during server event sync", { error: String(err) });
    }

    // Server-wide buffs (events/donation perks) should be applied to connected players.
    // This is intentionally best-effort and lightweight.
    try {
      if (process.env.PW_TICK_SERVER_BUFFS !== "0") {
        syncServerBuffsToConnectedPlayers(this.entities, this.sessions, now);
      }
    } catch (err: any) {
      this.log.warn("Error during server buff sync", { error: String(err) });
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

        const nm: any = this.npcs as any;

        // Resolve the DOT applier's *player entityId*.
        // StatusEffects stores appliedById as a CharacterState.id (NOT sessionId).
        let attackerEntityId: string | undefined = undefined;

        try {
          const appliedByKind = (meta as any)?.appliedByKind;
          const appliedById = (meta as any)?.appliedById;

          if (appliedByKind === "character" && typeof appliedById === "string") {
            let ownerSessionId: string | undefined = undefined;

            try {
              for (const s of (this.sessions as any)?.getAllSessions?.() ?? (this.sessions as any)?.values?.() ?? []) {
                if ((s as any)?.character?.id === appliedById) {
                  ownerSessionId = (s as any)?.id;
                  break;
                }
              }
            } catch {
              // ignore
            }

            if (ownerSessionId) {
              const byOwner = (this.entities as any)?.getEntityByOwner?.(ownerSessionId);
              if (byOwner && typeof byOwner.id === "string") attackerEntityId = byOwner.id;
            }
          }
        } catch {
          // ignore
        }

        // Prefer routing through NpcManager.applyDotDamage so fatal ticks go through the
        // canonical death pipeline (XP/loot/corpse/respawn). Fall back to applyDamage.
        if (nm) {
          try {

            // ✅ Canonical DOT route (prefer detailed variant if available)
            if (typeof nm.applyDotDamageDetailed === "function") {
              const d = nm.applyDotDamageDetailed((ent as any).id, amount, meta, attackerEntityId);
              if (d && typeof d.hp === "number") {
                this.emitDotTickLine(meta as any, ent as any, d.effectiveDamage ?? amount, d.hp, d.absorbed);
                return;
              }
            }

            if (typeof nm.applyDotDamage === "function") {
              const r = nm.applyDotDamage((ent as any).id, amount, meta, attackerEntityId);
              if (typeof r === "number") {
                this.emitDotTickLine(meta as any, ent as any, amount, r);
                return;
              }
            }
// Fallback: legacy damage path
            if (typeof nm.applyDamage === "function") {
              const beforeHp = typeof (ent as any).hp === "number" ? (ent as any).hp : undefined;
              const r = nm.applyDamage(
                (ent as any).id,
                amount,
                attackerEntityId ? { entityId: attackerEntityId } : undefined
              );

              if (typeof r === "number") {
                this.emitDotTickLine(meta as any, ent as any, amount, r);
                return;
              }

              if (beforeHp !== undefined && typeof (ent as any).hp === "number" && (ent as any).hp !== beforeHp) {
                this.emitDotTickLine(meta as any, ent as any, amount, (ent as any).hp);
                return;
              }
            }
          } catch {
            // fall through to raw HP fallback
          }
        }

        // Absolute fallback: mutate the in-memory entity HP directly (tests/dev).
        const hp0 =
          typeof (ent as any).hp === "number"
            ? (ent as any).hp
            : typeof (ent as any).maxHp === "number"
              ? (ent as any).maxHp
              : 0;

        (ent as any).hp = Math.max(0, Math.floor(hp0) - Math.floor(amount));
        this.emitDotTickLine(meta as any, ent as any, amount, (ent as any).hp);
      });
    }
  }

  /**
   * Emit a DOT tick combat line to the applier (caster).
   * Defaults ON; disable via PW_DOT_TICK_MESSAGES=0.
   */
  private emitDotTickLine(meta: any, targetEnt: any, damage: number, hpAfter?: number, absorbed?: number): void {
    try {
      if (process.env.PW_DOT_TICK_MESSAGES === "0") return;

      const appliedByKind = meta?.appliedByKind;
      const appliedById = meta?.appliedById;
      if (appliedByKind !== "character" || typeof appliedById !== "string") return;

      // Find the session for this character id.
      let ownerSession: any = null;
      for (const s of (this.sessions as any)?.getAllSessions?.() ?? (this.sessions as any)?.values?.() ?? []) {
        if ((s as any)?.character?.id === appliedById) { ownerSession = s; break; }
      }
      if (!ownerSession) return;

      const spellName = String(meta?.name ?? meta?.sourceId ?? "DOT");
      const tgtName = String(targetEnt?.name ?? "Target");
      const dmg = Math.floor(damage);
      const abs = typeof absorbed === "number" ? Math.floor(absorbed) : 0;

      const line = formatWorldSpellDotTickLine({
        spellName,
        targetName: tgtName,
        damage: dmg,
        absorbed: abs > 0 ? abs : undefined,
        hpAfter: typeof hpAfter === "number" ? hpAfter : undefined,
        maxHp: typeof (targetEnt as any)?.maxHp === "number" ? (targetEnt as any).maxHp : undefined,
      });
      this.sessions.send(ownerSession, "mud_result", { text: line });
    } catch {
      // ignore
    }
  }
}
