//worldcore/shards/WorldBlueprint.ts

import { Region } from "../terrain/regions/RegionTypes";

// High-level boundary for the shard (the “play dome”)
export interface WorldBoundary {
  centerX: number;
  centerZ: number;
  radius: number;     // hard cutoff
  softRadius: number; // where we start fading / warning

  type?: string;      // e.g. "dome", "island", "rifted"
}

// Static world object from the blueprint
export type WorldObjectKind =
  | "tree"
  | "rock"
  | "ore_vein"
  | "herb_node"
  | "bush"
  | "stump"
  | "log"
  | "crystal"
  | "ruin"
  | "shrine"
  | "campfire"
  | "tent"
  | "crate"
  | "barrel"
  | "anvil"
  | "forge"
  | "well"
  | "statue"
  | "portal"
  | "bridge"
  | "boat"
  | "dock"
  | "road_marker";

export interface BlueprintObject {
  id: string;
  kind: WorldObjectKind;
  displayName: string;

  // Tag from biome system (e.g. "temperate_forest", "desert"), or null
  biomeTag: string | null;

  // World-space position in terrain grid coordinates (same grid as WGE)
  worldX: number;
  worldZ: number;

  // Simple collision radius (XZ)
  radius: number;
  blocking: boolean;

  // Optional loot / resource meta
  lootTableId?: string;
  resourceTag?: string;

  /**
   * Optional sprite identifier for 2.5D / web client.
   *  e.g. "tree_oak_01", "ore_copper_01"
   */
  spriteId?: string;
}

export type SpawnKind =
  | "player_start"
  | "town"
  | "dungeon"
  | "poi";

export interface SpawnPoint {
  id: string;
  kind: SpawnKind;

  worldX: number;
  worldZ: number;

  radius?: number; // for multi-spawn areas
  tags?: string[]; // e.g. ["prime_city", "tutorial"]
}

// Canonical shard blueprint used by the MMO backend
export interface WorldBlueprint {
  id: string;       // blueprint id
  name: string;     // display name (e.g. "Prime Shard – Westfall Rim")

  // Optional: which runtime shard this blueprint is normally bound to.
  // Older code creating blueprints without this remains valid.
  shardId?: string;

  seed: number;     // WGE seed
  width: number;    // terrain grid width
  height: number;   // terrain grid height

  boundary: WorldBoundary;

  // Region summaries derived from RegionMap/WGE
  regions: Region[];

  // Static world detail
  objects: BlueprintObject[];
  spawns: SpawnPoint[];

  // Versioning / audit
  createdAt: number;
  version: number;
}

// ---------------------------------------------------------------------------
// Demo / fallback world builder
// Used by ServerWorldManager when no DB-backed blueprint is provided yet.
// ---------------------------------------------------------------------------

export function buildDemoPrimeWorld(): WorldBlueprint {
  const now = Date.now();

  const boundary: WorldBoundary = {
    centerX: 0,
    centerZ: 0,
    radius: 2048,      // hard cutoff
    softRadius: 1792,  // start “you are leaving the shard” warnings
    type: "dome",
  };

  const regions: Region[] = []; // we can plug real regions in later

  const objects: BlueprintObject[] = [];

  const spawns: SpawnPoint[] = [
    {
      id: "prime_start",
      kind: "player_start",
      worldX: 0,
      worldZ: 0,
      radius: 10,
      tags: ["prime_start", "tutorial"],
    },
  ];

  return {
    id: "prime_shard_blueprint",
    name: "Prime Shard – Demo Plains",
    shardId: "prime_shard",

    seed: 12345,  // TODO: wire to real WGE seed later
    width: 4096,  // terrain grid size stub
    height: 4096,

    boundary,
    regions,
    objects,
    spawns,

    createdAt: now,
    version: 1,
  };
}
