// worldcore/npc/NpcManager.ts

import { EntityManager } from "../core/EntityManager";
import { SessionManager } from "../core/SessionManager";
import { Logger } from "../utils/logger";
import {
  NpcRuntimeState,
  NpcPrototype,
  getNpcPrototype,
} from "./NpcTypes";
import {
  PerceivedPlayer,
  NpcPerception,
} from "../ai/NpcBrainTypes";
import { LocalSimpleAggroBrain } from "../ai/LocalSimpleNpcBrain";
import { markInCombat, killEntity } from "../mud/MudHelperFunctions";

const log = Logger.scope("NPC");

export class NpcManager {
  private npcsByEntityId = new Map<string, NpcRuntimeState>();
  private npcsByRoom = new Map<string, Set<string>>();

  // v0 in-process brain; later we can swap this to a remote client.
  private readonly brain = new LocalSimpleAggroBrain();

  constructor(private readonly entities: EntityManager) {}

  /**
   * Spawn an NPC of a given prototype into a room at the given position.
   * Returns the runtime state (linked to a real Entity).
   */
  spawnNpc(
    proto: NpcPrototype,
    roomId: string,
    x: number,
    y: number,
    z: number,
    variantId?: string | null
  ): NpcRuntimeState {
    // use EntityManager's NPC creation helper
    const e = this.entities.createNpcEntity(roomId, proto.model ?? proto.name);

    // Resource nodes are not NPCs (semantics), even if they use the same spawn pipeline.
    const tags = proto.tags ?? [];
    const isResource =
      tags.includes("resource") ||
      tags.some((t) => t.startsWith("resource_"));

    if (isResource) {
      e.type = "node";
      (e as any).protoId = proto.id;
    } else {
      e.type = "npc";
      (e as any).protoId = proto.id;
    }

    // sync Entity fields
    e.hp = proto.maxHp;
    e.maxHp = proto.maxHp;
    e.alive = true;
    e.name = proto.name;

    this.entities.setPosition(e.id, x, y, z);

    const state: NpcRuntimeState = {
      entityId: e.id,
      protoId: proto.id, // base proto id (stable)
      templateId: proto.id, // resolved prototype key used
      variantId: variantId ?? null, // incarnation
      roomId,
      hp: proto.maxHp,
      maxHp: proto.maxHp,
      alive: true,
    };

    this.npcsByEntityId.set(e.id, state);

    let set = this.npcsByRoom.get(roomId);
    if (!set) {
      set = new Set<string>();
      this.npcsByRoom.set(roomId, set);
    }
    set.add(e.id);

    log.info("NPC spawned", {
      protoId: proto.id,
      entityId: e.id,
      roomId,
      x,
      y,
      z,
    });

    return state;
  }

  getEntity(entityId: string): any {
    return this.entities.get(entityId);
  }

  /**
   * Convenience: spawn by prototype id or return null if not found.
   */
  spawnNpcById(
    protoId: string,
    roomId: string,
    x: number,
    y: number,
    z: number,
    variantId?: string | null
  ): NpcRuntimeState | null {
    const templateId =
      variantId && variantId.trim().length > 0
        ? `${protoId}@${variantId.trim()}`
        : protoId;

    // Try variant first, fall back to base
    const proto =
      getNpcPrototype(templateId) ?? getNpcPrototype(protoId);
    if (!proto) {
      log.warn("spawnNpcById: unknown proto", {
        protoId,
        variantId,
        templateId,
      });
      return null;
    }

    const state = this.spawnNpc(proto, roomId, x, y, z);

    // annotate (keeps quest/progression stable on protoId)
    (state as any).protoId = protoId;
    (state as any).variantId = variantId ?? null;
    (state as any).templateId = proto.id;

    return state as any;
  }

  getNpcStateByEntityId(entityId: string): NpcRuntimeState | undefined {
    return this.npcsByEntityId.get(entityId);
  }

  listNpcsInRoom(roomId: string): NpcRuntimeState[] {
    const set = this.npcsByRoom.get(roomId);
    if (!set) return [];

    const out: NpcRuntimeState[] = [];
    for (const entityId of set) {
      const st = this.npcsByEntityId.get(entityId);
      if (st) out.push(st);
    }
    return out;
  }

  despawnNpc(entityId: string): void {
    const st = this.npcsByEntityId.get(entityId);
    if (!st) return;

    this.npcsByEntityId.delete(entityId);

    const set = this.npcsByRoom.get(st.roomId);
    if (set) {
      set.delete(entityId);
      if (set.size === 0) {
        this.npcsByRoom.delete(st.roomId);
      }
    }

    this.entities.removeEntity(entityId);

    log.info("NPC despawned", { entityId });
  }

  /**
   * Soft damage hook that keeps runtime + Entity in sync.
   * Returns the new HP.
   */
  applyDamage(entityId: string, amount: number): number | null {
    const st = this.npcsByEntityId.get(entityId);
    if (!st) return null;

    const e = this.entities.get(entityId) as any;
    if (!e) return null;

    const newHp = Math.max(0, st.hp - Math.max(0, amount));
    st.hp = newHp;
    st.alive = newHp > 0;

    e.hp = newHp;
    e.alive = newHp > 0;

    return newHp;
  }

  /**
   * v1 AI hook: scan NPCs and run simple behaviors.
   *
   * - Builds a perception for each NPC
   * - Asks the brain for a decision
   * - For attack decisions, applies simple damage to the target player
   *   and sends them a combat line via SessionManager (if provided)
   */
  updateAll(deltaMs: number, sessions?: SessionManager): void {
    for (const [entityId, st] of this.npcsByEntityId.entries()) {
      const npcEntity: any = this.entities.get(entityId);
      if (!npcEntity) continue;

      const roomId = st.roomId;

      // --- Build perception: players in same room ---
      const playersInRoom: PerceivedPlayer[] = [];
      try {
        const ents = this.entities.getEntitiesInRoom(roomId) as any[];
        for (const e of ents) {
          if (e.type !== "player") continue;

          const hp =
            typeof e.hp === "number"
              ? e.hp
              : typeof e.maxHp === "number"
              ? e.maxHp
              : 0;

          const maxHp =
            typeof e.maxHp === "number" && e.maxHp > 0
              ? e.maxHp
              : hp || 1;

          playersInRoom.push({
            entityId: e.id,
            characterId: (e as any).characterId,
            hp,
            maxHp,
          });
        }
      } catch {
        // If perception fails for this room, just skip this NPC this tick.
      }

      const perception: NpcPerception = {
        npcId: entityId,
        entityId,
        roomId,
        hp: st.hp,
        maxHp: st.maxHp,
        alive: st.alive,
        hostile: npcEntity.type === "npc", // v1: all "npc" entities are hostile
        currentTargetId: undefined,
        playersInRoom,
        sinceLastDecisionMs: deltaMs,
      };

      const decision = this.brain.decide(perception, deltaMs);
      if (!decision) continue;

      switch (decision.kind) {
        case "attack_entity": {
          // Resolve the target; we only support player targets in v1.
          const target = this.entities.get(
            decision.targetEntityId
          ) as any;
          if (!target || target.type !== "player") {
            break;
          }

          // Mirror the simple mob damage logic from MudActions.applySimpleNpcCounterAttack
          const maxHp =
            typeof target.maxHp === "number" && target.maxHp > 0
              ? target.maxHp
              : 100;
          const hp =
            typeof target.hp === "number" ? target.hp : maxHp;

          if (hp <= 0) {
            // Already dead, nothing to do.
            break;
          }

          const base =
            typeof npcEntity.attackPower === "number"
              ? npcEntity.attackPower
              : Math.max(1, Math.round(maxHp * 0.03)); // 3% of max HP baseline

          const roll = 0.8 + Math.random() * 0.4; // ±20%
          const dmg = Math.max(1, Math.floor(base * roll));
          const newHp = Math.max(0, hp - dmg);

          target.hp = newHp;

          markInCombat(target);
          markInCombat(npcEntity);

          let line: string;

          if (newHp <= 0) {
            killEntity(target);
            line = `[combat] ${npcEntity.name} hits you for ${dmg} damage.
You die. (0/${maxHp} HP) Use 'respawn' to return to safety or wait for someone to resurrect you.`;
          } else {
            line = `[combat] ${npcEntity.name} hits you for ${dmg} damage.
(${newHp}/${maxHp} HP)`;
          }

          // Send the combat line to the owning session, if we know it.
          if (sessions) {
            const ownerSessionId = (target as any).ownerSessionId;
            if (ownerSessionId) {
              const s = sessions.get(ownerSessionId);
              if (s) {
                sessions.send(s, "chat", {
                  from: "[world]",
                  sessionId: "system",
                  text: line,
                  t: Date.now(),
                });
              }
            }
          }

          break;
        }

        case "say":
        case "move_to_room":
        case "flee":
        case "idle":
        default:
          // No-op for now – these will be wired into higher-level
          // systems (chat, movement, etc.) later.
          break;
      }
    }
  }
}
