//worldcore/core/TerrainStream.ts

import { SessionManager } from "./SessionManager";
import { TerrainStreamFacade } from "./MessageRouter";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { Session } from "../shared/Session";
import { Logger } from "../utils/logger";

/**
 * Simple terrain stream v1
 *
 * This is intentionally small and safe:
 *  - on terrain_request, we sample a tiny height patch around (x, z)
 *  - send it back via ServerOpcode "terrain" with kind = "simple_height_patch"
 *
 * Later, this can be replaced or extended with full WGEv3 chunk protocol
 * without changing the MessageRouter or SessionManager APIs.
 */
export class TerrainStream implements TerrainStreamFacade {
  private readonly log = Logger.scope("TERRAIN_STREAM");

  constructor(
    private readonly world: ServerWorldManager,
    private readonly sessions: SessionManager
  ) {}

  handleChunkRequest(session: Session, payload: any): void {
    const hm = this.world.getHeightmap();

    const centerX = Number(payload?.x ?? payload?.centerX ?? 0) || 0;
    const centerZ = Number(payload?.z ?? payload?.centerZ ?? 0) || 0;

    // Tiny 9x9 grid around the requested point
    const half = Number(payload?.halfSize ?? 4) || 4;
    const step = Number(payload?.step ?? 4) || 4; // world units between samples

    const width = half * 2 + 1;
    const height = half * 2 + 1;

    const heights: number[] = [];

    for (let dz = -half; dz <= half; dz++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = centerX + dx * step;
        const z = centerZ + dz * step;
        // Heightmap.sample(x, z, biome?) – biome left undefined for now
        const h = hm.sample(x, z);
        heights.push(h);
      }
    }

    this.log.debug("terrain_request handled", {
      sessionId: session.id,
      centerX,
      centerZ,
      width,
      height,
      step,
    });

    this.sessions.send(session, "terrain", {
      kind: "simple_height_patch",
      centerX,
      centerZ,
      width,
      height,
      step,
      heights,
      t: Date.now(),
    });
  }

  /**
   * Envelope-style terrain ops.
   * For now we just log them and can later use this to handle:
   *  - subscription messages
   *  - streaming chunk updates
   *  - multi-LOD terrain feeds
   */
  handleTerrainEnvelope(session: Session, payload: any): void {
    this.log.debug("terrain envelope received (stub)", {
      sessionId: session.id,
      payload,
    });

    // Example future pattern:
    // if (payload?.kind === "subscribe") { ... }
    // if (payload?.kind === "unsubscribe") { ... }
  }
}
