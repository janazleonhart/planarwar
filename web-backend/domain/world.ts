//backend/src/domain/world.ts

export type RegionId =
  | "heartland_basin"
  | "sunfall_coast"
  | "gloamwood_veil"
  | "emberreach_highlands"
  | "obsidian_span";

export interface Region {
  id: RegionId;
  name: string;
  biome: "plains" | "forest" | "coast" | "mountain" | "swamp" | "mixed";
  dangerLevel: number; // 1-10
}

export interface Shard {
  id: string; // e.g. "prime_shard"
  name: string;
  regions: Region[];
}

export interface World {
  shards: Shard[];
}

export function seedWorld(): World {
  const primeShard: Shard = {
    id: "prime_shard",
    name: "Prime Shard – Heartland Frontier",
    regions: [
      {
        id: "heartland_basin",
        name: "Heartland Basin",
        biome: "plains",
        dangerLevel: 2,
      },
      {
        id: "sunfall_coast",
        name: "Sunfall Coast",
        biome: "coast",
        dangerLevel: 4,
      },
      {
        id: "gloamwood_veil",
        name: "Gloamwood Veil",
        biome: "forest",
        dangerLevel: 6,
      },
      {
        id: "emberreach_highlands",
        name: "Emberreach Highlands",
        biome: "mountain",
        dangerLevel: 5,
      },
      {
        id: "obsidian_span",
        name: "Obsidian Span",
        biome: "mountain",
        dangerLevel: 8,
      },
    ],
  };

  return {
    shards: [primeShard],
  };
}
