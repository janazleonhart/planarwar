// worldcore/world/WorldQueryService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

const log = Logger.scope("WORLD_QUERY");

export interface LookResult {
  regionId: string | null;
  regionName?: string;
  regionKind?: string;

  objects: Array<{
    objectId: string;
    type: string;
    x: number;
    y: number;
    z: number;
  }>;

  spawns: Array<{
    spawnId: string;
    type: string;
    archetype: string;
  }>;
}

export interface InspectRegionResult {
  regionId: string;
  name: string;
  kind: string;

  objectCount: number;
  spawnCount: number;
  polygonPoints: number;
}

export class WorldQueryService {
  async look(shardId: string, regionId: string | null): Promise<LookResult> {
    if (!regionId) {
      return {
        regionId: null,
        objects: [],
        spawns: [],
      };
    }

    const region = await db.query(
      `SELECT name, kind FROM regions WHERE shard_id = $1 AND region_id = $2`,
      [shardId, regionId]
    );

    const objects = await db.query(
      `
        SELECT object_id, type, x, y, z
        FROM world_objects
        WHERE shard_id = $1 AND region_id = $2
        ORDER BY object_id
      `,
      [shardId, regionId]
    );

    const spawns = await db.query(
      `
        SELECT spawn_id, type, archetype
        FROM spawn_points
        WHERE shard_id = $1 AND region_id = $2
        ORDER BY spawn_id
      `,
      [shardId, regionId]
    );

    return {
      regionId,
      regionName: region.rows[0]?.name,
      regionKind: region.rows[0]?.kind,
      objects: objects.rows.map(r => ({
        objectId: r.object_id,
        type: r.type,
        x: r.x,
        y: r.y,
        z: r.z,
      })),
      spawns: spawns.rows.map(r => ({
        spawnId: r.spawn_id,
        type: r.type,
        archetype: r.archetype,
      })),
    };
  }

  async inspectRegion(shardId: string, regionId: string): Promise<InspectRegionResult | null> {
    const region = await db.query(
      `SELECT name, kind FROM regions WHERE shard_id = $1 AND region_id = $2`,
      [shardId, regionId]
    );

    if (region.rowCount === 0) return null;

    const objects = await db.query(
      `SELECT COUNT(*) FROM world_objects WHERE shard_id = $1 AND region_id = $2`,
      [shardId, regionId]
    );

    const spawns = await db.query(
      `SELECT COUNT(*) FROM spawn_points WHERE shard_id = $1 AND region_id = $2`,
      [shardId, regionId]
    );

    const polys = await db.query(
      `SELECT COUNT(*) FROM region_polygons WHERE shard_id = $1 AND region_id = $2`,
      [shardId, regionId]
    );

    return {
      regionId,
      name: region.rows[0].name,
      kind: region.rows[0].kind,
      objectCount: Number(objects.rows[0].count),
      spawnCount: Number(spawns.rows[0].count),
      polygonPoints: Number(polys.rows[0].count),
    };
  }
}
