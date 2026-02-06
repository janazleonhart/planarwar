// worldcore/core/EntityManager.ts

import { uuidv4 } from "../utils/uuid";
import { Entity } from "../shared/Entity";
import { Logger } from "../utils/logger";

const log = Logger.scope("ENTITY");

// Optional: gate chatty debug logs behind an env flag so we don’t spam
const DEBUG_ENTITY = process.env.PW_DEBUG_ENTITY === "1";

export class EntityManager {
  // Invariant: every entity we know about lives in this Map.
  // Key = entity.id
  private entities: Map<string, Entity> = new Map();

  /**
   * Create (or reuse) a player entity bound to a session + room.
   *
   * Invariants enforced here:
   *  - At most one "player" entity per sessionId.
   *  - Rebinding always forces the entity back to a clean "player" type.
   */
  createPlayerForSession(sessionId: string, roomId: string): Entity {
    const existing = this.getEntityByOwner(sessionId);
    if (existing) {
      log.debug("createPlayerForSession: reusing existing entity", {
        sessionId,
        entityId: existing.id,
        roomId,
      });

      // Always rebind to the new room
      existing.roomId = roomId;

      // HEAL: if anything ever mutated this entity (e.g. got tagged as a node),
      // force it back to a player entity on reuse.
      existing.type = "player";
      existing.ownerSessionId = sessionId;

      const exAny = existing as any;
      if (exAny.spawnPointId !== undefined) delete exAny.spawnPointId;
      if (exAny.protoId !== undefined) delete exAny.protoId;

      return existing;
    }

    const id = uuidv4();
    const e: Entity = {
      id,
      type: "player",
      roomId,
      ownerSessionId: sessionId,
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      hp: 100,
      maxHp: 100,
      alive: true,
      name: `Player-${sessionId.substring(0, 6)}`,
    };

    this.entities.set(id, e);
    log.info("Player entity created", { entityId: e.id, roomId, ownerSessionId: sessionId });
    return e;
  }

  /**
   * Simple helper to create an NPC entity in a room.
   * Used by early test content like Town Rat / dummies.
   */
  createNpcEntity(roomId: string, model: string): Entity {
    const id = uuidv4();

    const e: Entity = {
      id,
      type: "npc",
      roomId,
      model,
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      hp: 50,
      maxHp: 50,
      alive: true,
      name: model,
    };

    this.entities.set(id, e);
    log.info("NPC entity created", { entityId: e.id, model, roomId });
    return e;
  }

/**
 * Create a pet entity bound to an owner entity id.
 * v1: pets are simple room-bound entities that reuse the existing combat pipeline.
 */
createPetEntity(roomId: string, model: string, ownerEntityId: string): Entity {
  const id = uuidv4();

  const e: Entity = {
    id,
    type: "pet",
    roomId,
    model,
    ownerEntityId,
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    hp: 40,
    maxHp: 40,
    alive: true,
    name: model,
    petMode: "defensive",
    followOwner: true,
  } as any;

  this.entities.set(id, e);
  log.info("Pet entity created", { entityId: e.id, model, roomId, ownerEntityId });
  return e;
}

/** Returns the first pet owned by the given owner entity id (v1 supports 1 pet). */
getPetByOwnerEntityId(ownerEntityId: string): Entity | undefined {
  const e = Array.from(this.entities.values()).find(
    (ent: any) => ent.type === "pet" && String((ent as any).ownerEntityId ?? "") === String(ownerEntityId)
  );
  return e;
}

/** Remove the pet owned by owner entity id (v1). Returns true if removed. */
removePetForOwnerEntityId(ownerEntityId: string): boolean {
  const pet = this.getPetByOwnerEntityId(ownerEntityId);
  if (!pet) return false;
  this.removeEntity(pet.id);
  log.info("Pet entity removed", { entityId: pet.id, ownerEntityId });
  return true;
}

  /** Direct lookup by entity id. */
  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * Returns all entities currently in a given room.
   *
   * Note: this is still O(N) over all entities; that’s fine for now.
   * If/when we need to optimize, we’ll add a room index here.
   */
  getEntitiesInRoom(roomId: string): Entity[] {
    const list = Array.from(this.entities.values()).filter((e) => e.roomId === roomId);

    if (DEBUG_ENTITY) {
      log.debug("getEntitiesInRoom", { roomId, count: list.length });
    }

    return list;
  }

  /**
   * Find the "player" entity owned by a given session.
   *
   * Invariant:
   *  - We treat (type === "player" && ownerSessionId === sessionId)
   *    as the canonical “this session’s body”.
   */
  getEntityByOwner(sessionId: string): Entity | undefined {
    const e = Array.from(this.entities.values()).find(
      (ent) => ent.type === "player" && ent.ownerSessionId === sessionId
    );
    if (!e && DEBUG_ENTITY) {
      log.debug("getEntityByOwner: miss", { sessionId });
    }
    return e;
  }

  /** Snapshot of all entities (use sparingly). */
  getAll(): Entity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Remove an entity from the world.
   *
   * NOTE: This does not send any network messages; the caller
   * is responsible for sending entity_despawn to clients.
   */
  removeEntity(id: string): void {
    if (this.entities.delete(id)) {
      log.info("Entity removed", { entityId: id });
    } else if (DEBUG_ENTITY) {
      log.debug("removeEntity: attempt to remove unknown entity", { entityId: id });
    }
  }

  /**
   * Convenience for movement systems; directly updates x/y/z.
   * Higher level code should usually also handle room transitions.
   */
  setPosition(entityId: string, x: number, y: number, z: number): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;

    // If your entity uses posX/posY/posZ instead, change these.
    entity.x = x;
    entity.y = y;
    entity.z = z;
  }
}
