// worldcore/core/CombatSystem.ts

import { EntityManager } from "./EntityManager";
import { RoomManager } from "./RoomManager";
import { SessionManager } from "./SessionManager";
import { Session } from "../shared/Session";
import { Logger } from "../utils/logger";

/**
 * PLANAR WAR – CombatSystem v1 (safe stub)
 *
 * Responsibilities for now:
 *  - Handle set_target
 *  - Handle cast
 *  - Broadcast simple events to the room
 *
 * Real damage / aggro / cooldowns come later once the rest of the
 * core is fully wired and the auth/character system is online.
 */
export class CombatSystem {
  private readonly log = Logger.scope("COMBAT");

  constructor(
    private readonly entities: EntityManager,
    private readonly rooms: RoomManager,
    private readonly sessions: SessionManager
  ) {}

  // -------------------------------------------------------------
  // TARGETING
  // -------------------------------------------------------------

  setTarget(session: Session, targetId?: string): void {
    const roomId = session.roomId;
    if (!roomId) {
      this.log.debug("setTarget: session not in room", {
        sessionId: session.id,
        targetId,
      });
      this.sessions.send(session, "error", { code: "not_in_room" });
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.log.warn("setTarget: room not found", {
        sessionId: session.id,
        roomId,
        targetId,
      });
      this.sessions.send(session, "error", { code: "room_not_found" });
      return;
    }

    const me = this.entities.getEntityByOwner(session.id);
    if (!me) {
      this.log.warn("setTarget: no entity for session", {
        sessionId: session.id,
        roomId,
        targetId,
      });
      this.sessions.send(session, "error", { code: "no_entity" });
      return;
    }

    // Stash the target on the entity (simple, for now)
    me.targetId = targetId;

    this.log.info("setTarget: updated", {
      sessionId: session.id,
      entityId: me.id,
      roomId,
      targetId: targetId ?? null,
    });

    // Broadcast to the room so UIs can update target frames
    room.broadcast("target_set", {
      sourceId: session.id,
      entityId: me.id,
      targetId: targetId ?? null,
    });
  }

  // -------------------------------------------------------------
  // CAST ABILITY
  // -------------------------------------------------------------

  handleCast(session: Session, payload: any): void {
    const roomId = session.roomId;
    if (!roomId) {
      this.log.debug("cast: session not in room", {
        sessionId: session.id,
        payload,
      });
      this.sessions.send(session, "error", { code: "not_in_room" });
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.log.warn("cast: room not found", {
        sessionId: session.id,
        roomId,
        payload,
      });
      this.sessions.send(session, "error", { code: "room_not_found" });
      return;
    }

    const abilityId =
      payload?.abilityId ??
      payload?.spellId ??
      payload?.id ??
      "unknown_ability";

    const targetId =
      payload?.targetId ??
      payload?.target ??
      null;

    this.log.info("cast: received", {
      sessionId: session.id,
      roomId,
      abilityId,
      targetId,
    });

    // In future, we’ll run full resolution (range check, LOS, etc.) here.
    // For now, just broadcast the cast to the room as an event.
    room.broadcast("ability_cast", {
      casterId: session.id,
      abilityId,
      targetId,
      t: Date.now(),
    });
  }
}
