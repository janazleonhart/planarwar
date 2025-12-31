// worldcore/core/ObjectStream.ts

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

  handleObjectRequest(session: Session, _payload: unknown): void {
    // v1: always use the prime world blueprint.
    const shard = this.world.getWorldBlueprint();

    if (!shard) {
      this.log.warn("Object request but no world blueprint", {
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
