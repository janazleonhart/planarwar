//worldcore/world/ServerWorldManager.ts

import { Logger } from "../utils/logger";
import { Heightmap } from "../terrain/height/Heightmap";
import { RegionMap } from "../terrain/regions/RegionMap";
import type { Region } from "../terrain/regions/RegionTypes";

import {
  WorldBlueprint,
} from "../shards/WorldBlueprint";
import { buildWorldBlueprint } from "../terrain/worldgen/ScaledWorldgen";

import type { WorldBlueprintProvider } from "../core/RoomManager";

/**
 * ServerWorldManager v1
 *
 * Responsibilities (for now):
 *  - Own the Heightmap + RegionMap for the main shard
 *  - Hold a WorldBlueprint and hand it to RoomManager (world_blueprint op)
 *  - Provide simple helpers for other systems (terrain / AI later)
 *
 * This is intentionally MUCH simpler than the old Redis / storage monster.
 * We treat a single WorldBlueprint as the live shard (prime_shard).
 */
export class ServerWorldManager implements WorldBlueprintProvider {
  private readonly log = Logger.scope("WORLD");

  private readonly seed: number;

  private readonly heightmap: Heightmap;
  private readonly regionMap: RegionMap;

  private readonly world: WorldBlueprint;
  private readonly shardId: string;

  constructor(seed: number = 0x1234abcd) {
    this.seed = seed;

    // --- Blueprint setup ---------------------------------------------------
    // Use the scaled "live" world blueprint for the prime shard.
    // This is the production-scale shard, not a tiny dev dome.
    const bp: WorldBlueprint = buildWorldBlueprint({
      shardId: "prime_shard",
      seed,
    });
    this.world = bp;
    this.shardId = bp.shardId ?? "prime_shard";

    const worldRadius =
      (bp.boundary && typeof bp.boundary.radius === "number"
        ? bp.boundary.radius
        : 2048);

    // --- Heightmap / RegionMap setup ---------------------------------------

    // Heightmap is the continuous terrain function
    this.heightmap = new Heightmap(this.seed);

    // RegionMap slices the world into coarse cells over a radius.
    this.regionMap = new RegionMap(this.heightmap, {
      worldId: this.shardId,
      seed: this.seed,
      worldRadius,
      cellSize: 64,
    });

    this.log.info("ServerWorldManager initialized", {
      worldId: this.world.id,
      worldName: this.world.name,
      shardId: this.shardId,
      seed: this.seed,
      regionCount: this.world.regions?.length ?? 0,
      worldRadius,
      cellSize: this.regionMap.cellSize,
    });
  }

  // -------------------------------------------------------------------------
  // WorldBlueprintProvider implementation
  // -------------------------------------------------------------------------

  /**
   * RoomManager asks us for a blueprint whenever someone joins a room.
   * For now, all rooms share the same prime world; later we can have
   * different room→shard mappings.
   */
  getWorldBlueprintForRoom(_roomId: string): WorldBlueprint {
    return this.world;
  }

  // -------------------------------------------------------------------------
  // Exposed helpers for other systems (terrain, AI, etc.)
  // -------------------------------------------------------------------------

  getWorldBlueprint(): WorldBlueprint {
    return this.world;
  }

  getHeightmap(): Heightmap {
    return this.heightmap;
  }

  getRegionMap(): RegionMap {
    return this.regionMap;
  }

  /**
   * Convenience: fetch the Region summary at world-space (x, z).
   */
  getRegionAt(x: number, z: number): Region | undefined {
    return this.regionMap.getRegionAt(x, z);
  }

  /**
   * Tiny helper so future systems can ask "is this inside the simulated disk?"
   */
  isInsideWorld(x: number, z: number): boolean {
    const r = this.regionMap as any;
    const radius: number | undefined = r.worldRadius;
    if (typeof radius !== "number") return true; // be permissive if not set
    return Math.abs(x) <= radius && Math.abs(z) <= radius;
  }
}
