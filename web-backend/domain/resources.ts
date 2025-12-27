// backend/src/domain/resources.ts

import fs from "fs";
import path from "path";

// -------------------------------
// Core resource types
// -------------------------------

// Simple “legacy” buckets (map cleanly to your current Resources)
export type ResourceKey =
  | "food"
  | "materials_generic"
  | "wealth"
  | "knowledge"
  | "unity"

  // Physical materials (future use)
  | "wood_common"
  | "wood_hard"
  | "stone_common"
  | "stone_fine"
  | "ore_iron"
  | "ore_mithril"

  // Herbs (future alchemy / enchanting)
  | "herb_common"
  | "herb_rare"

  // Mana aspects (spell schools)
  | "mana_arcane"
  | "mana_primal"   // fire/earth/wind/nature “raw” mana
  | "mana_shadow"   // dark / corruption
  | "mana_radiant"  // light
  | "mana_ice"

  // Ocean / river / luxury
  | "fish_common"
  | "fish_rare"
  | "salt"
  | "coral_arcane"
  | "pearls"
  | "mana_tidal";   // water / tide / storm mana

// Generic vector of resource amounts
export type ResourceVector = Partial<Record<ResourceKey, number>>;

// -------------------------------
// Catalog of specific items
// -------------------------------

export type ResourceFamily =
  | "food"
  | "material"
  | "herb"
  | "fish"
  | "mana"
  | "luxury"
  | "meta";

export type ResourceRarity = "common" | "uncommon" | "rare" | "legendary" | "mythic";

export interface ResourceItemDef {
    /** Unique ID for this resource type, used in missions/loot/etc. */
    id: string;
    /** Which ResourceKey bucket it contributes to. */
    key: ResourceKey;
    /** Display name. */
    name: string;
    /** Flavor + hint what it’s used for. */
    description: string;
    rarity: ResourceRarity;
    /** What city specialization this item belongs to (if any). */
    specializationId?: ResourceSpecializationId;
  }

// How a city "specializes" in a family of resources.
export type ResourceSpecializationId =
  | "spec_food_grain"
  | "spec_food_luxury"
  | "spec_wood_timber"
  | "spec_wood_hardwood"
  | "spec_stone_quarry"
  | "spec_stone_fine"
  | "spec_ore_iron"
  | "spec_ore_precious"
  | "spec_herb_common"
  | "spec_herb_rare"
  | "spec_fish_coastal"
  | "spec_fish_oceanic"
  | "spec_mana_arcane"
  | "spec_mana_primal"
  | "spec_mana_shadow"
  | "spec_mana_radiant"
  | "spec_mana_tidal";

// Master list – same data can be used by MMO + web layer.
const RESOURCE_DATA_FILES = [
    "food.json",
    "wood.json",
    "stone.json",
    "ore.json",
    "herbs.json",
    "fish.json",
    "mana.json",
  ];

// -------------------------------
// Lookup helpers
// -------------------------------

const ITEMS_BY_ID = new Map<string, ResourceItemDef>();
const ITEMS_BY_KEY = new Map<ResourceKey, ResourceItemDef[]>();

function loadResourceItemsFromDisk(): ResourceItemDef[] {
    const baseDir = path.join(__dirname, "..", "..", "data", "resources");
    const all: ResourceItemDef[] = [];
  
    for (const file of RESOURCE_DATA_FILES) {
      const fullPath = path.join(baseDir, file);
  
      if (!fs.existsSync(fullPath)) {
        console.warn(`[resources] Missing resource file: ${fullPath}, skipping.`);
        continue;
      }
  
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        const parsed = JSON.parse(raw) as ResourceItemDef[];
  
        for (const item of parsed) {
          // light sanity check so a bad JSON line doesn’t nuke the server
          if (!item.id || !item.key) {
            console.warn(
              `[resources] Skipping invalid resource in ${file}:`,
              item
            );
            continue;
          }
          all.push(item);
        }
      } catch (err) {
        console.error(
          `[resources] Failed to load ${fullPath}:`,
          (err as Error).message
        );
      }
    }
  
    return all;
  }
  
  // 🔹 authoritative in-memory catalog, loaded at startup
  const RESOURCE_ITEMS: ResourceItemDef[] = loadResourceItemsFromDisk();

export function getAllResourceItems(): ResourceItemDef[] {
  return RESOURCE_ITEMS;
}

export function getResourceItemById(id: string): ResourceItemDef | undefined {
  return ITEMS_BY_ID.get(id);
}

export function getResourceItemsByKey(key: ResourceKey): ResourceItemDef[] {
  return ITEMS_BY_KEY.get(key) ?? [];
}

// Generic helper: add a ResourceVector into a bucketed resource object
// (either the simple Resources bucket or another ResourceVector).
export function addResources(
    target: Record<string, number>,
    delta: ResourceVector
  ): Record<string, number> {
    const bucketMap: Partial<Record<ResourceKey, string>> = {
      // direct buckets
      food: "food",
      materials_generic: "materials",
      wealth: "wealth",
      knowledge: "knowledge",
      unity: "unity",
  
      // physical stuff → materials
      wood_common: "materials",
      wood_hard: "materials",
      stone_common: "materials",
      stone_fine: "materials",
      ore_iron: "materials",
      ore_mithril: "materials",
      herb_common: "materials",
      herb_rare: "materials",
      salt: "materials",
      coral_arcane: "materials",
  
      // fish → food
      fish_common: "food",
      fish_rare: "food",
  
      // pearls → wealth
      pearls: "wealth",
  
      // all mana aspects → mana
      mana_arcane: "mana",
      mana_primal: "mana",
      mana_shadow: "mana",
      mana_radiant: "mana",
      mana_ice: "mana",
      mana_tidal: "mana",
    };
  
    for (const [k, v] of Object.entries(delta)) {
      if (typeof v !== "number") continue;
      const key = k as ResourceKey;
      const outKey = bucketMap[key] ?? key; // final key we’ll add into
  
      const current = target[outKey] ?? 0;
      target[outKey] = current + v;
    }
  
    return target;
  }