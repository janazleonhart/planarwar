// worldcore/data/items/ItemDatabase.ts

// v1 shared item database.
//
// This is a trimmed, modernized replacement for the old
// src/world/items/ItemDatabase.ts fossil.
//
// It is intentionally SMALL and SAFE – just enough to:
//  - drive resource drops from worldgen nodes
//  - test inventories, banks, and rewards
//  - be shared by MMO + webend + MUD interfaces
//
// Full content will eventually be migrated into a proper DB
// and/or Genesis content pipeline.

import { ItemDef } from "./ItemTypes";

export const ItemDatabase: Record<string, ItemDef> = {
  // -----------------------------
  // Herbs
  // -----------------------------

  herb_leaf: {
    id: "herb_leaf",
    name: "Herbal Leaf",
    description: "A simple medicinal leaf used in basic salves and tonics.",
    category: "herb",
    maxStack: 50,
    rarity: "common",
    resourceTag: "herb_common",
    baseValue: 1,
  },

  herb_oil_seed: {
    id: "herb_oil_seed",
    name: "Oil Seed",
    description: "A pungent seed pressed into alchemical oils.",
    category: "herb",
    maxStack: 20,
    rarity: "common",
    resourceTag: "herb_oil",
    baseValue: 3,
  },

  // -----------------------------
  // Ores
  // -----------------------------

  copper_ore: {
    id: "copper_ore",
    name: "Copper Ore",
    description: "A chunk of copper-bearing stone. Smelt into bars.",
    category: "ore",
    maxStack: 40,
    rarity: "common",
    resourceTag: "ore_metal",
    baseValue: 2,
  },

  iron_ore: {
    id: "iron_ore",
    name: "Iron Ore",
    description: "A heavier ore used for sturdy weapons and armor.",
    category: "ore",
    maxStack: 40,
    rarity: "common",
    resourceTag: "ore_metal",
    baseValue: 4,
  },

  mana_shard: {
    id: "mana_shard",
    name: "Mana Shard",
    description: "A faintly glowing shard of crystallized mana.",
    category: "resource",
    maxStack: 20,
    rarity: "rare",
    resourceTag: "ore_magic",
    baseValue: 25,
  },

  soul_crystal: {
    id: "soul_crystal",
    name: "Soul Crystal",
    description: "A resonant crystal that remembers great deeds.",
    category: "resource",
    maxStack: 10,
    rarity: "epic",
    resourceTag: "rare_crystal",
    baseValue: 100,
  },

  // -----------------------------
  // Lumber
  // -----------------------------

  wood_log: {
    id: "wood_log",
    name: "Wood Log",
    description: "A sturdy log useful for construction and campfires.",
    category: "lumber",
    maxStack: 30,
    rarity: "common",
    resourceTag: "wood_softwood",
    baseValue: 1,
  },

  tree_resin: {
    id: "tree_resin",
    name: "Tree Resin",
    description: "Sticky resin used as a binding agent and in alchemy.",
    category: "lumber",
    maxStack: 10,
    rarity: "uncommon",
    resourceTag: "wood_softwood",
    baseValue: 5,
  },

  // -----------------------------
  // Basic tools (for web/city builder hooks)
  // -----------------------------

  stone_pickaxe: {
    id: "stone_pickaxe",
    name: "Stone Pickaxe",
    description: "A crude pickaxe for mining simple ore veins.",
    category: "tool",
    maxStack: 1,
    rarity: "common",
    baseValue: 12,
  },

  stone_hatchet: {
    id: "stone_hatchet",
    name: "Stone Hatchet",
    description: "A basic hatchet for felling small trees.",
    category: "tool",
    maxStack: 1,
    rarity: "common",
    baseValue: 10,
  },

  fishing_rod_simple: {
    id: "fishing_rod_simple",
    name: "Simple Fishing Rod",
    description: "A rough rod for catching small fish in quiet waters.",
    category: "tool",
    maxStack: 1,
    rarity: "common",
    baseValue: 15,
  },
};
