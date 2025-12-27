//worldcore/strategy/domain/world.ts

import { WorldBlueprint, ShardBlueprint, buildDemoPrimeWorld, } from "../../shards/WorldBlueprint";

export type RegionId = string;

/**
 * Domain-level view of a region for the city builder / strategy layer.
 * This wraps the lower-level worldcore Region and adds campaign stats like danger.
 */
export interface RegionInfo {
  id: RegionId;
  name: string;
  biome: string;

  /**
   * 1–10 “how spicy is this place” for warfront / threat drift.
   * Higher = more threat gain over time if ignored.
   */
  dangerLevel: number;

  /**
   * Simple tags for UI / missions (“frontier”, “starter”, “badlands”, etc.).
   */
  tags: string[];
}

/**
 * Single playable shard. Right now we only have one (Prime Shard),
 * but this structure is future-proof for multiple shards.
 */
export interface WorldShard {
  id: string;           // "prime_shard"
  name: string;         // "Prime Shard"
  regions: RegionInfo[];
}

/**
 * Domain-level world state stored inside GameState.
 * Note: the full topology is kept in `blueprint` for future features.
 */
export interface World {
  id: string;
  name: string;
  shards: WorldShard[];

  /**
   * Underlying worldcore blueprint that both MMO + webend can read.
   * Not strictly needed by the current routes, but gives us a clean bridge.
   */
  blueprint: WorldBlueprint;
}

/**
 * Quick biome → danger mapping for the demo world.
 * When we plug in full WGEv3, this can become data-driven.
 */
const BIOME_DANGER: Record<string, number> = {
  temperate_plains: 2,   // starter heartland
  coastal_cliffs: 4,
  boreal_forest: 5,
  highlands: 6,
  badlands: 8,
};

/**
 * Turn a blueprint region ID + biome into a nice display name.
 */
function prettyRegionName(id: string, biome: string): string {
  switch (id) {
    case "prime_heartland":
      return "Prime Heartland";
    case "prime_frontier_north":
      return "Northern Frontier";
    case "prime_frontier_south":
      return "Southern Frontier";
    case "prime_badlands_west":
      return "Western Badlands";
    case "prime_highlands_east":
      return "Eastern Highlands";
    default:
      return biome
        .split("_")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
  }
}

/**
 * Seeds the canonical world used by the city builder.
 * This is the only entry point `gameState.ts` cares about.
 */
export function seedWorld(): World {
  const seed = 1337; // stable for now; can be moved to config later
  const blueprint = buildDemoPrimeWorld(seed);

  // For now we just expose the first shard to the city builder.
  const shardBp = blueprint.shards[0];

  const regions: RegionInfo[] = shardBp.regions.map((r) => ({
    id: r.id,
    name: prettyRegionName(r.id, r.biome),
    biome: r.biome,
    dangerLevel: BIOME_DANGER[r.biome] ?? 3,
    tags: r.tags ?? [],
  }));

  const shard: WorldShard = {
    id: shardBp.id,
    name: shardBp.name,
    regions,
  };

  return {
    id: blueprint.id,
    name: blueprint.name,
    shards: [shard],
    blueprint,
  };
}
