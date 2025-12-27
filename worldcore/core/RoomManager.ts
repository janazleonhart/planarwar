//worldcore/core/RoomManager.ts

import { Session } from "../shared/Session";
import { SessionManager } from "./SessionManager";
import { EntityManager } from "./EntityManager";
import { Logger } from "../utils/logger";
import type { WorldBlueprint } from "../shards/WorldBlueprint";

import { Room } from "./Room";

// Small interface so any world manager can plug in
export interface WorldBlueprintProvider {
  getWorldBlueprintForRoom(roomId: string): WorldBlueprint;
}

export class RoomManager {
  private log = Logger.scope("ROOMS");
  private rooms = new Map<string, Room>();

  constructor(
    private sessions: SessionManager,
    private entities: EntityManager,
    private world?: WorldBlueprintProvider
  ) {}

  ensureRoom(roomId: string): Room {
    let r = this.rooms.get(roomId);
    if (!r) {
      r = new Room(roomId, this.sessions, this.entities);
      this.rooms.set(roomId, r);
      this.log.info("Created room", { roomId });
    }
    return r;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  listRooms(): { id: string; memberCount: number }[] {
    return Array.from(this.rooms.entries()).map(([id, room]) => ({
      id,
      memberCount: room.memberCount,
    }));
  }

  joinRoom(session: Session, roomId: string): void {
    const room = this.ensureRoom(roomId);

    if (session.roomId && session.roomId !== roomId) {
      const old = this.rooms.get(session.roomId);
      if (old) {
        this.log.info("Session leaving previous room", {
          sessionId: session.id,
          from: session.roomId,
          to: roomId,
        });
        old.leave(session);
      }
    }

    room.join(session);
    session.roomId = roomId;

    // Hand world blueprint to the joining session if we have a provider
    const isWorldRoom =
    roomId !== "lobby" && roomId !== "auth" && roomId !== "select_character";
    if (this.world && isWorldRoom) {
      try {
        const bp = this.world.getWorldBlueprintForRoom(roomId);
        this.sessions.send(session, "world_blueprint", { world: bp });
      } catch (err) {
        this.log.warn("Failed to fetch world blueprint for room", {
          roomId,
          sessionId: session.id,
          err,
        });
      }
    }
  }

  leaveRoom(session: Session): void {
    const roomId = session.roomId;
    if (!roomId) return;
  
    const room = this.rooms.get(roomId);
    if (room) {
      room.leave(session);
    }
  
    session.roomId = null;
  }
  
}
