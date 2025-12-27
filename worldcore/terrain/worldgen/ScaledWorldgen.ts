// worldcore/terrain/worldgen/ScaledWorldgen.ts

//
// Ultra-light v1 shard world generator.
//
// Goal:
// - Produce a canonical WorldBlueprint for a shard
// - Stable ID/seed/boundary/size
// - Regions/objects/spawns are minimal but valid
//
// Later we can plug WGEv2 Landforms/Climate/Civilization into this
// without changing the public shape.

import {
  WorldBlueprint,
  WorldBoundary,
  SpawnPoint,
} from "../../shards/WorldBlueprint";

// Simple input used by backend(s) when they want a shard blueprint.
export interface ShardWorldInput {
  shardId: string;          // runtime shard instance (e.g. "prime_shard")
  worldId?: string;         // logical world id (default = shardId)
  name?: string;            // display (e.g. "Prime Shard – Elwynn Rim")
  seed: number;             // deterministic seed for terrain/regions
}

/**
 * Hard-coded prototype dimensions for now.
 *
 * We keep this simple on purpose:
 * - radius defines the dome boundary
 * - width/height are terrain grid size (cells)
 *
 * When we bring back WORLDSCALE + WorldDimensions, this function
 * is the only thing that needs to change.
 */
function buildPrototypeBoundary(): {
  boundary: WorldBoundary;
  width: number;
  height: number;
} {
  // 4k x 4k heightmap, 1 unit per cell for now.
  const radius = 2048;
  const width = radius * 2;
  const height = radius * 2;

  const boundary: WorldBoundary = {
    centerX: 0,
    centerZ: 0,
    radius,
    softRadius: Math.floor(radius * 0.9),
    type: "dome",
  };

  return { boundary, width, height };
}

/**
 * Default spawn list v1 – safe single start point at the dome center.
 */
function buildDefaultSpawns(): SpawnPoint[] {
  return [
    {
      id: "spawn_default_center",
      kind: "player_start",
      worldX: 0,
      worldZ: 0,
      radius: 8,
      tags: ["default_start", "prime"],
    },
  ];
}

/**
 * Main entry point: build a minimal, valid WorldBlueprint for the shard.
 */
export function buildWorldBlueprint(input: ShardWorldInput): WorldBlueprint {
  const now = Date.now();

  const worldId = input.worldId ?? input.shardId;
  const name =
    input.name ?? `Shard ${input.shardId} – Prototype (${worldId})`;

  const { boundary, width, height } = buildPrototypeBoundary();

  const blueprint: WorldBlueprint = {
    id: worldId,
    name,
    shardId: input.shardId,
    seed: input.seed,
    width,
    height,
    boundary,
    regions: [],          // filled later by RegionMap/WGE
    objects: [],          // filled later by civ/resources passes
    spawns: buildDefaultSpawns(),
    createdAt: now,
    version: 1,
  };

  return blueprint;
}
