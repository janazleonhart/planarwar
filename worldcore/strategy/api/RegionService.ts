//worldcore/strategy/api/RegionService.ts:

import type { WorldBlueprint, ShardBlueprint } from "../../shards/WorldBlueprint";
import type { Region, RegionId } from "../../terrain/regions/RegionTypes";

export class RegionService {
  constructor(private readonly world: WorldBlueprint) {}

  /**
   * All shards in this world.
   */
  getShards(): ShardBlueprint[] {
    return this.world.shards;
  }

  /**
   * All regions across all shards.
   */
  getAllRegions(): Region[] {
    return this.world.shards.flatMap((s) => s.regions);
  }

  /**
   * All regions for a specific shard.
   */
  getRegionsForShard(shardId: string): Region[] {
    const shard = this.world.shards.find((s) => s.id === shardId);
    return shard?.regions ?? [];
  }

  /**
   * Find a region by id.
   */
  getRegionById(id: RegionId): Region | undefined {
    for (const shard of this.world.shards) {
      const r = shard.regions.find((region) => region.id === id);
      if (r) return r;
    }
    return undefined;
  }

  /**
   * All regions matching a biome id (e.g. "temperate_plains").
   */
  getRegionsByBiome(biome: string): Region[] {
    return this.getAllRegions().filter((r) => r.biome === biome);
  }

  /**
   * All regions that have a given tag ("frontier", "starter", etc.).
   */
  getRegionsByTag(tag: string): Region[] {
    return this.getAllRegions().filter((r) => r.tags?.includes(tag));
  }

  /**
   * Simple helper for warfront / threat systems:
   * returns regions sorted by descending slope/danger-ish proxy.
   * (You can swap this out for a real "danger" metric later.)
   */
  getFrontierCandidates(limit: number = 5): Region[] {
    const regions = [...this.getAllRegions()];
    regions.sort((a, b) => (b.avgSlope ?? 0) - (a.avgSlope ?? 0));
    return regions.slice(0, limit);
  }
}
