// worldcore/npc/NpcManager.ts

import { EntityManager } from "../core/EntityManager";
import { Logger } from "../utils/logger";
import {
  NpcRuntimeState,
  NpcPrototype,
  getNpcPrototype,
} from "./NpcTypes";

const log = Logger.scope("NPC");

export class NpcManager {
  private npcsByEntityId = new Map<string, NpcRuntimeState>();
  private npcsByRoom = new Map<string, Set<string>>();

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
      tags.includes("resource") || tags.some((t) => t.startsWith("resource_"));
    if (isResource) {
      e.type = "node";
      e.protoId = proto.id;
    } else {
        e.type = "npc";
        e.protoId = proto.id;
    }

    // sync Entity fields
    e.hp = proto.maxHp;
    e.maxHp = proto.maxHp;
    e.alive = true;
    e.name = proto.name;

    this.entities.setPosition(e.id, x, y, z);

    const state: NpcRuntimeState = {
      entityId: e.id,
      protoId: proto.id,            // base proto id (stable)
      templateId: proto.id,         // NEW (resolved prototype key used)
      variantId: variantId ?? null, // NEW (incarnation)
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
      log.warn("spawnNpcById: unknown proto", { protoId, variantId, templateId });
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
    const e = this.entities.get(entityId);
    if (!e) return null;

    const newHp = Math.max(0, st.hp - Math.max(0, amount));
    st.hp = newHp;
    st.alive = newHp > 0;

    e.hp = newHp;
    e.alive = newHp > 0;

    return newHp;
  }

  /**
   * v1 stub: hook for AI ticks later. For now, this just exists so we can
   * wire it into TickEngine when we’re ready.
   */
  updateAll(deltaMs: number): void {
    // future: scan NPCs and run simple behaviors (wander, pursue, leash, etc.)
  }
}
