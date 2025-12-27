//worldcore/db/ShardStorage.ts

import { db } from "./Database";
import { Logger } from "../utils/logger";
import { WorldBlueprint } from "../shards/WorldBlueprint";

const log = Logger.scope("SHARD");

// add a row type if you haven't already
interface ShardRow {
  boundary: any;
  regions: any;
  objects: any;
  spawns: any;
}

export class ShardStorage {
  // ... shardExists and saveWorldBlueprint stay as-is ...

  async loadWorldBlueprint(id: string): Promise<WorldBlueprint | null> {
    const r = await db.query<ShardRow>(
      "SELECT boundary, regions, objects, spawns FROM shards WHERE shard_id = $1",
      [id]
    );

    if (r.rowCount === 0) {
      log.warn("loadWorldBlueprint: shard not found", { shardId: id });
      return null;
    }

    // rowCount > 0 here, so it's safe to assert with !
    const row = r.rows[0]!;

    const boundary = row.boundary ?? null;
    const regions = row.regions ?? [];
    const objects = row.objects ?? [];
    const spawns = row.spawns ?? [];

    const blueprint: WorldBlueprint = {
      id,
      name: id,      // can be overwritten later
      seed: 0,       // TODO: persist actual WGE seed
      width: 0,      // TODO: persist real dims
      height: 0,
      boundary,
      regions,
      objects,
      spawns,
      createdAt: Date.now(),
      version: 1,
    };

    log.info("Loaded world blueprint", {
      shardId: id,
      regionCount: regions.length,
      objectCount: objects.length,
      spawnCount: spawns.length,
    });

    return blueprint;
  }
}
