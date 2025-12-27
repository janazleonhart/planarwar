// worldcore/data/items/ItemTypes.ts

// Canonical item type definitions shared by:
//  - MMO backend
//  - webend / city builder
//  - future MUD / web client
//
// This replaces the old src/world/items/ItemDatabase.ts type section
// and provides a stable "item model" for everything to share.

export type ItemCategory =
  | "material"
  | "ore"
  | "herb"
  | "lumber"
  | "tool"
  | "weapon"
  | "armor"
  | "consumable"
  | "quest"
  | "currency"
  | "trinket"
  | "resource"; // generic catchall when needed

export type ItemRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary";

/**
 * Optional resource type tags that line up with worldgen/resource masks.
 * These are what tie items to harvest nodes:
 *  - ore nodes -> "ore_metal", "ore_magic"
 *  - herb nodes -> "herb_common", ...
 *  - tree nodes -> "wood_softwood", ...
 */
export type ResourceTag =
  | "ore_metal"
  | "ore_magic"
  | "herb_common"
  | "herb_oil"
  | "wood_softwood"
  | "wood_hardwood"
  | "fish_common"
  | "rare_crystal";

/**
 * Base item definition shared across all systems.
 */
export interface ItemDef {
  id: string;

  name: string;
  description?: string;

  category: ItemCategory;
  rarity?: ItemRarity;

  maxStack: number;

  /**
   * Optional resource linkage.
   * If set, this item can drop from / be produced by nodes or systems
   * that reference the same resourceTag.
   */
  resourceTag?: ResourceTag;

  /**
   * Optional value / vendor hint.
   * Fully fleshed-out econ will live elsewhere; this is a simple default.
   */
  baseValue?: number;
}
