//worldcore/core/SessionManager.ts

import { WebSocket } from "ws";
import { Session } from "../shared/Session";
import { ServerMessage, ServerOpcode } from "../shared/messages";
import { Logger } from "../utils/logger";

const log = Logger.scope("SESSIONS");

let SESSION_COUNTER = 0;

export class SessionManager {
  private sessions = new Map<string, Session>();

  // ---------------------------------------------------------------------------
  // Creation / lookup
  // ---------------------------------------------------------------------------

  /**
   * Create and register a new session bound to a WebSocket.
   *
   * NOTE:
   *  - displayName is just a label; real identity is attached later.
   */
  createSession(socket: WebSocket, displayName: string): Session {
    const id = this.nextId();
    const now = Date.now();

    const session: Session = {
      id,
      displayName,
      socket,
      roomId: null,
      lastSeen: now,
      shardId: "prime_shard", // default; can be overridden later
    };

    this.sessions.set(id, session);

    log.info("Session created", {
      sessionId: id,
      displayName,
    });

    return session;
  }

  /** Direct lookup by id. Used by Room and various systems. */
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * Iterator over all sessions.
   *
   * Used by:
   *  - server.ts (personal node refresh loop)
   *  - legacy heartbeat (before Core v0.9)
   */
  values(): Iterable<Session> {
    return this.sessions.values();
  }

  /**
   * More explicit alias for values(), for new code that
   * wants a clearer name.
   */
  getAllSessions(): Iterable<Session> {
    return this.sessions.values();
  }

  /** Number of active sessions; used by TickEngine for stats. */
  count(): number {
    return this.sessions.size;
  }

  // ---------------------------------------------------------------------------
  // Activity / idle tracking
  // ---------------------------------------------------------------------------

  /**
   * Mark a session as active "now".
   *
   * Called by MessageRouter whenever a message is received.
   */
  touch(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.lastSeen = Date.now();
  }

  // ---------------------------------------------------------------------------
  // Sending messages
  // ---------------------------------------------------------------------------

  /**
   * Send a typed server message to a specific session.
   *
   * op must be a valid ServerOpcode; payload is arbitrary.
   */
  send<P = any>(
    session: Session,
    op: ServerOpcode,
    payload?: P
  ): void {
    const msg: ServerMessage<P> = {
      op,
      payload,
    };

    const json = JSON.stringify(msg);

    try {
      session.socket.send(json);
    } catch (err) {
      log.warn("Failed to send message to session", {
        sessionId: session.id,
        op,
        err,
      });
    }
  }

  /**
   * Broadcast a message to all sessions.
   * (Not heavily used yet, but handy for world-level notices.)
   */
  broadcast<P = any>(op: ServerOpcode, payload?: P): void {
    const msg: ServerMessage<P> = {
      op,
      payload,
    };
    const json = JSON.stringify(msg);

    for (const s of this.sessions.values()) {
      try {
        s.socket.send(json);
      } catch (err) {
        log.warn("Failed to send broadcast message", {
          sessionId: s.id,
          op,
          err,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Removal / cleanup
  // ---------------------------------------------------------------------------

  /**
   * Remove a session from the manager and close its socket.
   *
   * NOTE:
   *  - Heartbeat and server.ts both call this. Room cleanup is done
   *    by RoomManager/Heartbeat before calling removeSession.
   */
  removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }

    try {
      // Defensive: closing a closed socket should be safe, but wrap anyway.
      session.socket.close(1000, "session_removed");
    } catch (err) {
      log.warn("Error closing socket for session", {
        sessionId: id,
        err,
      });
    }

    this.sessions.delete(id);

    log.info("Session removed", { sessionId: id });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private nextId(): string {
    SESSION_COUNTER++;
    return `S${Date.now().toString(36)}${SESSION_COUNTER.toString(36)}`;
  }
}
