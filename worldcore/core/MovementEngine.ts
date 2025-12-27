//worldcore/core/MovementEngine.ts

import { ServerWorldManager } from "../world/ServerWorldManager";
import { Session } from "../shared/Session";
import { Logger } from "../utils/logger";

export interface ClientMovePayload {
  x?: number;
  y?: number;
  z?: number;
  rotY?: number;
  // later: tick, sequence, input flags, etc.
}

export interface ResolvedMove {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/**
 * MovementEngine v1
 *
 * Very simple:
 *  - validates client x/z/rotY
 *  - samples the heightmap for ground Y
 *  - clamps Y so we don't fall below terrain
 *
 * Real movement (velocity, time-based deltas, anti-speedhack, pathing)
 * gets layered on top once the rest of the core is stable.
 */
export class MovementEngine {
  private readonly log = Logger.scope("MOVEMENT");

  constructor(private readonly world: ServerWorldManager) {}

  /**
   * Apply a client move request.
   * Returns a resolved transform, or null if the payload is bad.
   */
  applyClientMove(
    session: Session,
    payload: ClientMovePayload
  ): ResolvedMove | null {
    let { x, y, z, rotY } = payload;

    // ---- Basic input validation ----

    if (typeof x !== "number" || !Number.isFinite(x)) {
      this.log.warn("applyClientMove: bad x", {
        sessionId: session.id,
        x,
        payload,
      });
      return null;
    }

    if (typeof z !== "number" || !Number.isFinite(z)) {
      this.log.warn("applyClientMove: bad z", {
        sessionId: session.id,
        z,
        payload,
      });
      return null;
    }

    if (typeof rotY !== "number" || !Number.isFinite(rotY)) {
      rotY = 0;
    }

    // Normalize rotY to [-π, π] just to keep things sane
    const twoPi = Math.PI * 2;
    rotY = ((rotY % twoPi) + twoPi) % twoPi;
    if (rotY > Math.PI) rotY -= twoPi;

    // ---- Terrain sampling ----

    const heightmap = this.world.getHeightmap();

    let groundY: number;
    try {
      // biome param is optional in our Heightmap; pass nothing for now
      groundY = heightmap.sample(x, z);
    } catch (err) {
      this.log.error("applyClientMove: heightmap.sample failed", {
        sessionId: session.id,
        x,
        z,
        err,
      });
      return null;
    }

    // Keep player a bit above the terrain
    const minHeight = groundY + 0.5;

    if (typeof y !== "number" || !Number.isFinite(y)) {
      y = minHeight;
    } else if (y < minHeight - 3.0) {
      // Prevent the classic "fell through the world to -∞".
      y = minHeight;
    }

    // We *could* clamp to world bounds here using world.isInsideWorld(x,z),
    // but for v1 we just log if it's outside.
    if (!this.world.isInsideWorld(x, z)) {
      this.log.debug("applyClientMove: position outside nominal world radius", {
        sessionId: session.id,
        x,
        z,
      });
    }

    return { x, y, z, rotY };
  }
}
