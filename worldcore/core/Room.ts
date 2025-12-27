//worldcore/core/Room.ts

import { SessionManager } from "./SessionManager";
import { EntityManager } from "./EntityManager";
import { Logger } from "../utils/logger";
import { Session } from "../shared/Session";
import { ServerOpcode } from "../shared/messages";

export class Room {
  private log = Logger.scope("ROOM");
  private members = new Set<string>();

  constructor(
    private id: string,
    private sessions: SessionManager,
    private entities: EntityManager
  ) {}

  get roomId(): string {
    return this.id;
  }

  get memberCount(): number {
    return this.members.size;
  }

  has(sessionId: string): boolean {
    return this.members.has(sessionId);
  }

  private isWorldRoomId(roomId: string): boolean {
    // v1: UI-only rooms (no entity streaming)
    return !(roomId === "lobby" || roomId === "auth" || roomId === "select_character");
  }

  private isEntityVisibleTo(viewerSessionId: string, e: any): boolean {
    if (!e) return false;
  
    // Everyone can see NPCs and other players.
    if (e.type === "npc" || e.type === "mob" || e.type === "player") return true;
  
    // Personal nodes/objects: only the owner can see them.
    const isNodeLike = e.type === "node" || e.type === "object";
    const hasSpawnPoint = typeof e.spawnPointId === "number";
  
    if (isNodeLike && hasSpawnPoint) {
      // If it has an owner, only that owner sees it
      if (e.ownerSessionId && e.ownerSessionId !== viewerSessionId) return false;
      return true;
    }
  
    // Default: visible (tune later)
    return true;
  }

  join(session: Session): void {
    if (this.members.has(session.id)) {
      this.log.debug("join: session already in room", {
        roomId: this.id,
        sessionId: session.id,
      });
      return;
    }

    this.members.add(session.id);

     // Non-world rooms are just subscription buckets for UI flows.
     // Do NOT create player entities or broadcast spawns there.
     if (!this.isWorldRoomId(this.id)) {
       this.log.info("Session joined non-world room", {
         roomId: this.id,
         sessionId: session.id,
         memberCount: this.members.size,
       });
       return;
     }

    // Ensure player entity exists for this session
    const entity = this.entities.createPlayerForSession(session.id, this.id);

    // IMPORTANT: apply character position BEFORE sending entity_list.
    // Otherwise clients see self at (0,0,0) on join and only later get corrected.
    const ch = (session as any).character;
    if (ch) {
      if (typeof ch.posX === "number") entity.x = ch.posX;
      if (typeof ch.posY === "number") entity.y = ch.posY;
      if (typeof ch.posZ === "number") entity.z = ch.posZ;
      if (typeof ch.rotY === "number") entity.rotY = ch.rotY;
      if (typeof ch.name === "string" && ch.name.length > 0) entity.name = ch.name;
    }

    this.log.info("Session joined room", {
      roomId: this.id,
      sessionId: session.id,
      memberCount: this.members.size,
      entityId: entity.id,
    });

    // Tell the joining client about themselves + others (minimal bones pass)
    this.sessions.send(session, "entity_list", {
      self: entity,
      // Include ALL other entities in the room (players + NPCs + resources),
      // not just other players.
      others: this.entities
        .getEntitiesInRoom(this.id)
        .filter((e) => e.id !== entity.id)
        .filter((e) => {
          // Always show other players
          if (e.type === "player") return true;
          // Shared world entities (NPCs, props, etc.)
          if (!e.ownerSessionId) return true;
          // Personal entities: only visible to owner
          return e.ownerSessionId === session.id;
        }),
    });

    // Let everyone else know a new player appeared
    this.broadcastExcept(session.id, "entity_spawn", {
      id: entity.id,
      ownerSessionId: session.id,
      name: session.displayName,
      roomId: this.id,
    });
  }

  leave(session: Session): void {
    if (this.members.delete(session.id)) {
      this.log.info("Session left room", {
        roomId: this.id,
        sessionId: session.id,
        memberCount: this.members.size,
      });

      // Non-world rooms never spawned entities, so they also never despawn.
      if (!this.isWorldRoomId(this.id)) {
        return;
      }
      
      // Find player entity
      const player = this.entities.getEntityByOwner(session.id);
      const playerId = player?.id;

      // Remove personal entities (nodes, etc.)
      for (const e of this.entities.getEntitiesInRoom(this.id)) {
        if (e.ownerSessionId === session.id && e.id !== playerId) {
          this.entities.removeEntity(e.id);
          // owner-only despawn is enough, but broadcasting is safe too
          this.sessions.send(session, "entity_despawn", { id: e.id });
        }
      }

      // Remove player entity + broadcast to others
      if (playerId) {
        this.entities.removeEntity(playerId);
        this.broadcast("entity_despawn", { id: playerId, ownerSessionId: session.id });
      }
      
      // Broadcast despawn to others
      this.broadcastExcept(session.id, "entity_despawn", {
        ownerSessionId: session.id,
      });
    } else {
      this.log.debug("leave: session not in room", {
        roomId: this.id,
        sessionId: session.id,
      });
    }
  }

  broadcast(op: ServerOpcode, payload?: any): void {
    for (const id of this.members) {
      const s = this.sessions.get(id);
      if (!s) continue;
      this.sessions.send(s, op, payload);
    }
  }

  broadcastExcept(excludedId: string, op: ServerOpcode, payload?: any): void {
    for (const id of this.members) {
      if (id === excludedId) continue;
      const s = this.sessions.get(id);
      if (!s) continue;
      this.sessions.send(s, op, payload);
    }
  }

  sendTo(targetId: string, op: ServerOpcode, payload?: any): void {
    const s = this.sessions.get(targetId);
    if (s) {
      this.sessions.send(s, op, payload);
    } else {
      this.log.debug("sendTo: no such session", {
        roomId: this.id,
        targetId,
      });
    }
  }
}
