// worldcore/world/ServerWorldManager.ts

/**
 * Server-side world authority for the shard. Owns the Heightmap and RegionMap,
 * builds the shard WorldBlueprint via ScaledWorldgen, and implements
 * WorldBlueprintProvider so rooms and streams can fetch the canonical layout.
 */

import { Logger } from "../utils/logger";
import { Heightmap } from "../terrain/height/Heightmap";
import { RegionMap } from "../terrain/regions/RegionMap";
import type { Region } from "../terrain/regions/RegionTypes";
import { WorldBlueprint } from "../shards/WorldBlueprint";
import { buildWorldBlueprint } from "../terrain/worldgen/ScaledWorldgen";
import type { WorldBlueprintProvider } from "../core/RoomManager";

import {
  PRIME_SHARD_REGIONS,
  buildRegionSemanticIndex,
  flagsToSemanticTags,
  type RegionSemanticDefinition,
} from "./PrimeShardRegions";

import { db } from "../db/Database";
import { initSpellsFromDbOnce } from "../spells/SpellTypes";

export class ServerWorldManager implements WorldBlueprintProvider {
  private readonly log = Logger.scope("WORLD");

  private readonly seed: number;
  private readonly heightmap: Heightmap;
  private readonly regionMap: RegionMap;
  private readonly world: WorldBlueprint;
  private readonly shardId: string;

  private regionSemanticById: Map<string, RegionSemanticDefinition>;

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
      bp.boundary && typeof bp.boundary.radius === "number"
        ? bp.boundary.radius
        : 2048;

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

    // --- Region semantics overlay ------------------------------------------
    // This is the “MMO meaning” layer: names/flags/law/tier for key regions.
    // (kept separate from terrain generation)
    this.regionSemanticById = buildRegionSemanticIndex(PRIME_SHARD_REGIONS);

    this.log.info("ServerWorldManager initialized", {
      worldId: this.world.id,
      worldName: this.world.name,
      shardId: this.shardId,
      seed: this.seed,
      regionCount: this.world.regions?.length ?? 0,
      worldRadius,
      cellSize: this.regionMap.cellSize,
      semanticRegions: this.regionSemanticById.size,
    });

    // One-time DB spell/song catalog load (definitions only).
    // Safe during transition: if tables are missing, SpellTypes keeps code defaults.
    if (process.env.WORLDCORE_TEST !== "1") {
      void initSpellsFromDbOnce(db);
    }
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
   * Allow the composition root (or future shard loader) to replace region defs.
   */
  setRegionDefinitions(defs: RegionSemanticDefinition[]): void {
    this.regionSemanticById = buildRegionSemanticIndex(defs);
  }

  /**
   * Convenience: fetch the Region summary at world-space (x, z).
   * This returns the terrain Region, optionally enriched with semantic metadata.
   */
  getRegionAt(x: number, z: number): Region | undefined {
    const base = this.regionMap.getRegionAt(x, z);
    if (!base) return undefined;

    const meta = this.regionSemanticById.get(base.id);
    if (!meta) return base;

    const semanticTags = [
      ...(meta.tags ?? []),
      ...flagsToSemanticTags(meta.flags),
    ];

    const mergedTags = Array.from(
      new Set([...(base.tags ?? []), ...semanticTags]),
    );

    // We intentionally return an object that is *wider* than Region.
    // TS is fine with this at runtime; consumers can opt into these fields.
    return {
      ...base,
      name: meta.name,
      tier: meta.tier,
      lawLevel: meta.lawLevel,
      flags: meta.flags,
      tags: mergedTags,
    } as any;
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
