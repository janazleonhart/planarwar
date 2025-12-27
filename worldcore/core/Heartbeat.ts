// worldcore/core/Heartbeat.ts

import { SessionManager } from "./SessionManager";
import { RoomManager } from "./RoomManager";
import { Logger } from "../utils/logger";

export interface HeartbeatConfig {
  intervalMs: number;    // how often to sweep sessions
  idleTimeoutMs: number; // how long before we drop an idle session
}

const log = Logger.scope("HEARTBEAT");

/**
 * Heartbeat v1 (Core v0.9)
 *
 * Responsibilities:
 *  - Periodically sweep all sessions
 *  - Drop any that have been idle longer than idleTimeoutMs
 *  - Clean up room membership before removal
 *
 * It does NOT:
 *  - Run gameplay ticks (that's TickEngine's job)
 *  - Do any heavy per-session logging in normal operation
 */
export function startHeartbeat(
  sessions: SessionManager,
  rooms: RoomManager,
  cfg: HeartbeatConfig
): NodeJS.Timeout {
  // Don’t allow silly sub-second sweeps; this is a coarse-grained cleanup loop.
  const intervalMs = Math.max(cfg.intervalMs, 1000);
  const idleTimeoutMs = Math.max(cfg.idleTimeoutMs, intervalMs * 2);

  log.info("Starting heartbeat", {
    intervalMs,
    idleTimeoutMs,
  });

  let sweepCount = 0;

  const handle = setInterval(() => {
    sweepCount++;
    const now = Date.now();

    let total = 0;
    let timedOut = 0;

    // Use the public API instead of poking sessions.sessions.values()
    for (const session of sessions.getAllSessions()) {
      total++;

      const lastSeen = typeof session.lastSeen === "number" ? session.lastSeen : 0;
      const delta = now - lastSeen;

      if (delta > idleTimeoutMs) {
        timedOut++;

        log.info("Removing idle session", {
          sessionId: session.id,
          idleMs: delta,
        });

        // Always clean up room membership before removing the session
        try {
          rooms.leaveRoom(session);
        } catch (err) {
          log.warn("Error leaving room for idle session", {
            sessionId: session.id,
            err,
          });
        }

        sessions.removeSession(session.id);
      }
    }

    // Only log summaries occasionally or when we actually did work
    if (timedOut > 0 || sweepCount % 30 === 0) {
      log.debug("Heartbeat sweep complete", {
        sweep: sweepCount,
        activeSessions: total - timedOut,
        timedOut,
      });
    }
  }, intervalMs);

  // Not strictly necessary, but avoids holding process open solely by this timer.
  handle.unref?.();

  return handle;
}
