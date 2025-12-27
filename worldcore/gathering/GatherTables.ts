// worldcore/gathering/GatherTables.ts

export interface ResourceDrop {
    itemId: string;
    minQty: number;
    maxQty: number;
    weight: number;
  }
  
  export const HERB_TABLES: Record<string, ResourceDrop[]> = {
    // plains biome, tier 1
    "plains:1": [
      { itemId: "herb_peacebloom", minQty: 1, maxQty: 3, weight: 80 },
      { itemId: "herb_silverleaf", minQty: 1, maxQty: 2, weight: 20 },
    ],
    // plains biome, tier 3
    "plains:3": [
      { itemId: "herb_peacebloom", minQty: 1, maxQty: 3, weight: 40 },
      { itemId: "herb_silverleaf", minQty: 1, maxQty: 3, weight: 40 },
      { itemId: "herb_sunblossom", minQty: 1, maxQty: 2, weight: 20 }, // rarer mid-tier herb
    ],
    // plains biome, tier 5 (deep, dangerous)
    "plains:5": [
      { itemId: "herb_sunblossom", minQty: 1, maxQty: 3, weight: 60 },
      { itemId: "herb_nightshade", minQty: 1, maxQty: 2, weight: 40 }, // rare
    ],
    // ... forest:*, hills:*, etc.
  };
  