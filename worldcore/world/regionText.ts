// worldcore/world/regionText.ts

export function extractWorldId(regionId: string | null | undefined): string {
    if (!regionId) return "unknown";
    // "prime_shard:0,-1" -> "prime_shard"
    const idx = regionId.indexOf(":");
    return idx >= 0 ? regionId.slice(0, idx) : regionId;
  }
  
  export function formatRegionLabel(regionId: string | null | undefined): string {
    return extractWorldId(regionId);
  }
  
  export function prettyRegionName(regionId: string | null | undefined): string {
    // For now this is identical; later you can map ids -> display names.
    return extractWorldId(regionId);
  }
  