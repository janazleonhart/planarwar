// worldcore/items/ItemCatalog.ts

import { ItemTemplate } from "./ItemTypes";

/**
 * Small built-in item catalog that does not depend on the database.
 *
 * These are mostly dev / bootstrap items so the world can function
 * even when Postgres has no rows in the `items` table yet.
 */
const ITEMS: Record<string, ItemTemplate> = {
  // ---------------------------------------------------------------------------
  // Starter gear
  // ---------------------------------------------------------------------------
  starter_sword_1: {
    id: "starter_sword_1",
    name: "Worn Training Sword",
    slot: "mainhand",
    maxStack: 1,
    stats: { str: 2, sta: 2 },
    category: "gear",
    description: "A nicked practice blade used by new recruits.",
    rarity: "common",
  },

  starter_shield_1: {
    id: "starter_shield_1",
    name: "Wooden Training Shield",
    slot: "offhand",
    maxStack: 1,
    stats: { sta: 3 },
    category: "gear",
    description: "A light shield made of cheap planks.",
    rarity: "common",
  },

  starter_boots_1: {
    id: "starter_boots_1",
    name: "Scuffed Leather Boots",
    slot: "feet",
    maxStack: 1,
    stats: { agi: 1 },
    category: "gear",
    description: "Broken-in boots that somehow still squeak.",
    rarity: "common",
  },

  // ---------------------------------------------------------------------------
  // Critter loot
  // ---------------------------------------------------------------------------
  rat_tail: {
    id: "rat_tail",
    name: "Rat Tail",
    slot: "material",
    maxStack: 99,
    category: "material",
    description: "A slightly gross trophy from a town rat.",
    rarity: "common",
    baseValue: 1,
  },

  rat_meat_raw: {
    id: "rat_meat_raw",
    name: "Stringy Rat Meat",
    slot: "food",
    maxStack: 20,
    category: "food",
    description: "Edible in the technical sense of the word.",
    rarity: "common",
    baseValue: 1,
  },

  // ---------------------------------------------------------------------------
  // Mining / ore
  // ---------------------------------------------------------------------------
  ore_iron_hematite: {
    id: "ore_iron_hematite",
    name: "Hematite Ore",
    slot: "material",
    maxStack: 99,
    category: "resource",
    description: "A chunk of iron-rich hematite.",
    rarity: "common",
    baseValue: 1,
  },

  // ---------------------------------------------------------------------------
  // Herbalism
  // ---------------------------------------------------------------------------
  herb_peacebloom: {
    id: "herb_peacebloom",
    name: "Peacebloom",
    slot: "material",
    maxStack: 99,
    category: "herb",
    description: "A gentle white flower favored by novice alchemists.",
    rarity: "common",
    baseValue: 1,
  },

  herb_silverleaf: {
    id: "herb_silverleaf",
    name: "Silverleaf",
    slot: "material",
    maxStack: 99,
    category: "herb",
    description: "Thin silver-veined leaves with a sharp scent.",
    rarity: "common",
    baseValue: 2,
  },

  herb_sunblossom: {
    id: "herb_sunblossom",
    name: "Sunblossom",
    slot: "material",
    maxStack: 99,
    category: "herb",
    description: "A bright herb that seems to hoard sunlight.",
    rarity: "uncommon",
    baseValue: 4,
  },

  herb_nightshade: {
    id: "herb_nightshade",
    name: "Nightshade",
    slot: "material",
    maxStack: 99,
    category: "herb",
    description: "A shadowy, toxic herb handled only with care.",
    rarity: "rare",
    baseValue: 8,
  },

  // ---------------------------------------------------------------------------
  // Quarrying
  // ---------------------------------------------------------------------------
  stone_granite: {
    id: "stone_granite",
    name: "Granite Block",
    slot: "material",
    maxStack: 99,
    category: "stone",
    description: "A dense block of speckled granite.",
    rarity: "common",
    baseValue: 1,
  },

  // ---------------------------------------------------------------------------
  // Lumbering
  // ---------------------------------------------------------------------------
  wood_oak: {
    id: "wood_oak",
    name: "Oak Log",
    slot: "material",
    maxStack: 99,
    category: "wood",
    description: "A sturdy length of oak, good for beams or bonfires.",
    rarity: "common",
    baseValue: 1,
  },

  // ---------------------------------------------------------------------------
  // Fishing
  // ---------------------------------------------------------------------------
  fish_river_trout: {
    id: "fish_river_trout",
    name: "River Trout",
    slot: "food",
    maxStack: 20,
    category: "fish",
    description: "A small trout, still faintly smelling of river water.",
    rarity: "common",
    baseValue: 1,
  },

  // ---------------------------------------------------------------------------
  // Farming / grain
  // ---------------------------------------------------------------------------
  grain_wheat: {
    id: "grain_wheat",
    name: "Bundle of Wheat",
    slot: "food",
    maxStack: 99,
    category: "grain",
    description: "Freshly cut stalks of wheat tied in a bundle.",
    rarity: "common",
    baseValue: 1,
  },

  // ---------------------------------------------------------------------------
  // Mana crystals / arcane gathering
  // ---------------------------------------------------------------------------
  mana_spark_arcane: {
    id: "mana_spark_arcane",
    name: "Arcane Spark",
    slot: "material",
    maxStack: 99,
    category: "mana",
    description: "A tiny shard of crystallised arcane energy.",
    rarity: "uncommon",
    baseValue: 5,
  },
};

/**
 * Lookup a static item template by id.
 * Used as a fallback when the database has no matching ItemDefinition.
 */
export function getItemTemplate(id: string): ItemTemplate | null {
  return ITEMS[id] ?? null;
}

/**
 * Convenience helper mainly for debugging and admin tooling.
 */
export function listAllItems(): ItemTemplate[] {
  return Object.values(ITEMS);
}
