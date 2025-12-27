//worldcore/core/ObjectStream.ts

import { SessionManager } from "./SessionManager";
import { ObjectStreamFacade } from "./MessageRouter";
import { ServerWorldManager } from "../world/ServerWorldManager";
import { Session } from "../shared/Session";
import { Logger } from "../utils/logger";

/**
 * Static World Object Stream v1
 *
 * For now:
 *  - On object_request, returns ALL objects and spawns from the shard
 *    as a single "object_chunk" response.
 *
 * Later:
 *  - We can add paging (chunk by region / cell)
 *  - Filter by room/shard
 *  - Different slices for web / 3D / MUD clients
 */
export class ObjectStream implements ObjectStreamFacade {
  private readonly log = Logger.scope("OBJ_STREAM");

  constructor(
    private readonly world: ServerWorldManager,
    private readonly sessions: SessionManager
  ) {}

  handleObjectRequest(session: Session, _payload: any): void {
    // For v1, we always use the primary shard blueprint.
    const shard = this.world.getShardBlueprint();

    if (!shard) {
      this.log.warn("Object request but no shard blueprint", {
        sessionId: session.id,
      });

      this.sessions.send(session, "object_chunk", {
        objects: [],
        spawns: [],
        done: true,
      });
      return;
    }

    const objects = shard.objects ?? [];
    const spawns = shard.spawns ?? [];

    this.log.info("Object request served", {
      sessionId: session.id,
      shardId: shard.id,
      objectCount: objects.length,
      spawnCount: spawns.length,
    });

    // Single-chunk v1 protocol; later we can add paging if needed.
    this.sessions.send(session, "object_chunk", {
      shardId: shard.id,
      objects,
      spawns,
      done: true,
    });
  }
}
