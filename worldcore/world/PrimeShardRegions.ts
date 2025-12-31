// worldcore/world/PrimeShardRegions.ts

export type RegionFlags = {
  isTown?: boolean;
  isSafeHub?: boolean;
  isGraveyard?: boolean;
  isLawless?: boolean;
};

export type RegionSemanticDefinition = {
  /** Must match the terrain RegionMap region id (ex: "prime_shard:0,0") */
  id: string;

  /** Human readable name */
  name: string;

  /** Rooms belonging to this region (for now we keep 1:1 with cell rooms) */
  zoneIds: string[];

  /** Optional semantic hints */
  tier?: number;
  lawLevel?: number;
  tags?: string[];
  flags?: RegionFlags;

  /** Optional legacy hooks (kept for future) */
  shard?: string;
  respawnPoint?: string;
};

export const PRIME_SHARD_REGIONS: RegionSemanticDefinition[] = [
  {
    id: "prime_shard:0,0",
    name: "Starter Hub",
    zoneIds: ["prime_shard:0,0"],
    tier: 1,
    lawLevel: 10,
    flags: { isTown: true, isSafeHub: true, isGraveyard: true },
    tags: ["starter"],
  },
  {
    id: "prime_shard:1,0",
    name: "Bandit Fields",
    zoneIds: ["prime_shard:1,0"],
    tier: 2,
    lawLevel: 0,
    flags: { isLawless: true },
    tags: ["bandits"],
  },
];

export function buildRegionSemanticIndex(
  defs: RegionSemanticDefinition[] = PRIME_SHARD_REGIONS,
): Map<string, RegionSemanticDefinition> {
  const map = new Map<string, RegionSemanticDefinition>();
  for (const d of defs) map.set(d.id, d);
  return map;
}

export function flagsToSemanticTags(flags?: RegionFlags): string[] {
  if (!flags) return [];
  const out: string[] = [];
  if (flags.isTown) out.push("town");
  if (flags.isSafeHub) out.push("safe_hub");
  if (flags.isGraveyard) out.push("graveyard");
  if (flags.isLawless) out.push("lawless");
  return out;
}
