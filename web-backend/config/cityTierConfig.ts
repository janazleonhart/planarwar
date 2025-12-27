//backend/src/config/cityTierConfig.ts

import fs from "node:fs";
import path from "node:path";
import type { TierUpCost } from "../gameState"; // we'll define that type there
import type { ResourceKey } from "../domain/resources";

export interface TierConfigEntry {
  tier: number;
  techRequirements?: string[];
  baseCost?: TierUpCost;
}

export interface CityMorphOption {
    id: string;
    label: string;
  
    // Thematic bucket for UI/grouping
    category:
      | "food"
      | "materials"
      | "wood"
      | "stone"
      | "ore"
      | "herb"
      | "mana"
      | "naval"
      | "wealth"
      | "knowledge"
      | "unity";
  
    // Which coarse per-tick stat this star amplifies right now
    resourceFocus: "food" | "materials" | "wealth" | "mana" | "knowledge" | "unity";
  
    // Optional: concrete stockpile key it’s “about” (for future fine-grained hooks)
    resourceKey?: ResourceKey;
  
    // % bonus per star (3 stars at 10% = +30% to that focus)
    bonusPerStarPct: number;
  
    description: string;
  }

  export interface CityMorphConfig {
    enabledFromTier: number;
    options: CityMorphOption[];
  }

export interface CityTierConfig {
  tiers: TierConfigEntry[];
  morph: CityMorphConfig;
}

let cachedConfig: CityTierConfig | null = null;

function loadConfigFromDisk(): CityTierConfig {
  const filePath = path.join(__dirname, "..", "..", "data", "cityTierConfig.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as CityTierConfig;

  // Make sure tiers are sorted
  parsed.tiers.sort((a, b) => a.tier - b.tier);
  return parsed;
}

export function getCityTierConfig(): CityTierConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfigFromDisk();
  }
  return cachedConfig;
}

export function getTierConfig(tier: number): TierConfigEntry | undefined {
  const cfg = getCityTierConfig();
  return cfg.tiers.find((t) => t.tier === tier);
}

export function getMorphConfig(): CityMorphConfig {
  return getCityTierConfig().morph;
}

export const DEFAULT_MORPH_CONFIG: CityMorphConfig = {
    enabledFromTier: 10,
    options: [
      // ==== FOOD-focused specializations ====
  
      {
        id: "granary_star",
        label: "Granary Star",
        category: "food",
        resourceFocus: "food",
        resourceKey: "food",
        bonusPerStarPct: 10,
        description:
          "Your city is obsessed with grain, storage, and predictable harvests. Each star boosts staple food output.",
      },
      {
        id: "feast_star",
        label: "Festival & Feast Star",
        category: "food",
        resourceFocus: "food",
        resourceKey: "food",
        bonusPerStarPct: 8,
        description:
          "Endless feasts, civic festivals, and food-forward culture. Stronger food output, with future hooks for unity buffs.",
      },
      {
        id: "preservation_star",
        label: "Preservation Star",
        category: "food",
        resourceFocus: "food",
        resourceKey: "salt",
        bonusPerStarPct: 7,
        description:
          "Smokehouses, salting guilds, and preservation magic. Food stretches further and spoilage hooks can later key off this.",
      },
  
      // ==== MATERIALS & GENERIC PRODUCTION ====
  
      {
        id: "artisan_star",
        label: "Artisan Quarter Star",
        category: "materials",
        resourceFocus: "materials",
        resourceKey: "materials_generic",
        bonusPerStarPct: 8,
        description:
          "Workshops, small industry, and clever reuse of scrap. Generic material throughput rises each star.",
      },
      {
        id: "logistics_star",
        label: "Logistics Star",
        category: "materials",
        resourceFocus: "materials",
        resourceKey: "materials_generic",
        bonusPerStarPct: 6,
        description:
          "Warehousing, roads, and caravans optimized to move bulk goods. Materials per tick improve via better flow.",
      },
  
      // ==== WOOD LINES ====
  
      {
        id: "forestry_star_common",
        label: "Forestry Star (Common Timber)",
        category: "wood",
        resourceFocus: "materials",
        resourceKey: "wood_common",
        bonusPerStarPct: 9,
        description:
          "Managed forests and efficient lumber camps focus on common timber. Construction ramps up quickly.",
      },
      {
        id: "forestry_star_hard",
        label: "Forestry Star (Hardwoods)",
        category: "wood",
        resourceFocus: "materials",
        resourceKey: "wood_hard",
        bonusPerStarPct: 11,
        description:
          "Slow-growing hardwood groves, elite logging crews, and carefully guarded stands. Fewer logs, higher value.",
      },
  
      // ==== STONE LINES ====
  
      {
        id: "quarry_star_common",
        label: "Quarry Star (Common Stone)",
        category: "stone",
        resourceFocus: "materials",
        resourceKey: "stone_common",
        bonusPerStarPct: 9,
        description:
          "Expansion-era quarries focused on volume over beauty. Walls, roads, and foundations thrive.",
      },
      {
        id: "quarry_star_fine",
        label: "Quarry Star (Fine Stone)",
        category: "stone",
        resourceFocus: "materials",
        resourceKey: "stone_fine",
        bonusPerStarPct: 11,
        description:
          "Fine-cut stone favored by temples and noble districts. Excellent for prestige buildings and monuments.",
      },
  
      // ==== ORE LINES ====
  
      {
        id: "smelter_star_iron",
        label: "Smelter Star (Iron)",
        category: "ore",
        resourceFocus: "materials",
        resourceKey: "ore_iron",
        bonusPerStarPct: 10,
        description:
          "Ironworks, bloomery furnaces, and a culture of steel. Perfect for mass weapons, armor, and heavy industry.",
      },
      {
        id: "smelter_star_mithril",
        label: "Smelter Star (Mithril)",
        category: "ore",
        resourceFocus: "materials",
        resourceKey: "ore_mithril",
        bonusPerStarPct: 12,
        description:
          "Secretive high-tier mines and arcane furnaces. Mithril goes into elite gear and future magical projects.",
      },
  
      // ==== HERB / ALCHEMY LINES ====
  
      {
        id: "herbarium_star_common",
        label: "Herbarium Star (Common Herbs)",
        category: "herb",
        resourceFocus: "knowledge",
        resourceKey: "herb_common",
        bonusPerStarPct: 8,
        description:
          "Every backyard has a garden, every alley an herbalist. Common herbs become abundant and well-documented.",
      },
      {
        id: "herbarium_star_rare",
        label: "Herbarium Star (Rare Herbs)",
        category: "herb",
        resourceFocus: "knowledge",
        resourceKey: "herb_rare",
        bonusPerStarPct: 12,
        description:
          "Rare, finicky plants cultivated in glasshouses and warded groves. Fuel for high-end alchemy and enchantments.",
      },
  
      // ==== MANA ASPECT LINES ====
  
      {
        id: "arcane_star",
        label: "Arcane Conduit Star",
        category: "mana",
        resourceFocus: "mana",
        resourceKey: "mana_arcane",
        bonusPerStarPct: 10,
        description:
          "Leylines, obelisks, and scholars obsessed with raw arcane structure. Ideal for generalist spellwork.",
      },
      {
        id: "primal_star",
        label: "Primal Heart Star",
        category: "mana",
        resourceFocus: "mana",
        resourceKey: "mana_primal",
        bonusPerStarPct: 10,
        description:
          "Totems, storms, and beast-rituals. Primal mana flows strongly, empowering elemental and druidic effects.",
      },
      {
        id: "shadow_star",
        label: "Shadow Well Star",
        category: "mana",
        resourceFocus: "mana",
        resourceKey: "mana_shadow",
        bonusPerStarPct: 11,
        description:
          "Secrets, pacts, and things best left unseen. Shadow mana fountains empower curses and covert operations.",
      },
      {
        id: "radiant_star",
        label: "Radiant Choir Star",
        category: "mana",
        resourceFocus: "mana",
        resourceKey: "mana_radiant",
        bonusPerStarPct: 11,
        description:
          "Cathedrals, sun-discs, and radiant hymns. Radiant mana buffs wards, healing, and morale.",
      },
      {
        id: "frost_star",
        label: "Frost Sigil Star",
        category: "mana",
        resourceFocus: "mana",
        resourceKey: "mana_ice",
        bonusPerStarPct: 10,
        description:
          "Runed icehouses and glacial shrines. Frost mana supports slowing effects, control, and preservation magic.",
      },
  
      // ==== NAVAL / FISH / OCEANIC LINES ====
  
      {
        id: "fishing_star_common",
        label: "Harbor Net Star",
        category: "naval",
        resourceFocus: "food",
        resourceKey: "fish_common",
        bonusPerStarPct: 9,
        description:
          "Nets, small boats, and well-organized harbors. Common fish become a reliable backbone of your food supply.",
      },
      {
        id: "fishing_star_rare",
        label: "Deepwater Fleet Star",
        category: "naval",
        resourceFocus: "wealth",
        resourceKey: "fish_rare",
        bonusPerStarPct: 11,
        description:
          "Long-range fishing fleets target rare delicacies. Ideal for luxury exports and high-tier rations.",
      },
      {
        id: "tidal_star",
        label: "Tidal Convergence Star",
        category: "naval",
        resourceFocus: "mana",
        resourceKey: "mana_tidal",
        bonusPerStarPct: 10,
        description:
          "Tidal stones, moon-charts, and storm readers. Tidal mana surges for oceanic rituals and naval buffs.",
      },
      {
        id: "reef_star",
        label: "Reef Temple Star",
        category: "naval",
        resourceFocus: "mana",
        resourceKey: "coral_arcane",
        bonusPerStarPct: 9,
        description:
          "Reef-worshipping cults and coral sanctums. Arcane coral supports wards, artifacts, and sea-related enchantments.",
      },
      {
        id: "pearl_star",
        label: "Pearl Cartel Star",
        category: "naval",
        resourceFocus: "wealth",
        resourceKey: "pearls",
        bonusPerStarPct: 12,
        description:
          "Diving guilds and carefully controlled pearl markets. Pearls become a cornerstone of your city’s luxury trade.",
      },
  
      // ==== WEALTH / CIVIC / KNOWLEDGE / UNITY LINEARITY ====
  
      {
        id: "trade_star",
        label: "Trade Consortium Star",
        category: "wealth",
        resourceFocus: "wealth",
        resourceKey: "wealth",
        bonusPerStarPct: 9,
        description:
          "Merchant leagues, guild halls, and contracts. Taxes and tariffs start doing serious heavy lifting.",
      },
      {
        id: "mint_star",
        label: "Royal Mint Star",
        category: "wealth",
        resourceFocus: "wealth",
        resourceKey: "wealth",
        bonusPerStarPct: 11,
        description:
          "Sophisticated coinage, credit systems, and financial oversight. Wealth output and money stability improve.",
      },
      {
        id: "academy_star",
        label: "Grand Academy Star",
        category: "knowledge",
        resourceFocus: "knowledge",
        resourceKey: "knowledge",
        bonusPerStarPct: 10,
        description:
          "Academies, libraries, and research circles. Raw knowledge output spikes, accelerating tech and arcane lore.",
      },
      {
        id: "unity_star",
        label: "Unity Hall Star",
        category: "unity",
        resourceFocus: "unity",
        resourceKey: "unity",
        bonusPerStarPct: 9,
        description:
          "Civic rituals, shared myths, and careful propaganda. Citizens pull together under a common banner.",
      }
    ],
  };