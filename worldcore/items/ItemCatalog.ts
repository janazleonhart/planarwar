// worldcore/items/ItemCatalog.ts

import { ItemTemplate } from "./ItemTypes";

// Simple built-in items (starter gear + basic drops).
// DB-backed definitions live in ItemService; this is just the static catalog.
const ITEMS: Record<string, ItemTemplate> = {
  starter_sword_1: {
    id: "starter_sword_1",
    name: "Worn Training Sword",
    slot: "mainhand",
    maxStack: 1,
    stats: { str: 2, sta: 2 },
    category: "gear",
    description: "A battered training sword. Better than a stick.",
    rarity: "common",
  },

  starter_shield_1: {
    id: "starter_shield_1",
    name: "Wooden Training Shield",
    slot: "offhand",
    maxStack: 1,
    stats: { sta: 3 },
    category: "gear",
    description: "Light shield, heavy splinters.",
    rarity: "common",
  },

  starter_boots_1: {
    id: "starter_boots_1",
    name: "Scuffed Leather Boots",
    slot: "feet",
    maxStack: 1,
    stats: { agi: 1 },
    category: "gear",
    description: "They squeak, but they work.",
    rarity: "common",
  },

  // --- Rat loot ---

  rat_tail: {
    id: "rat_tail",
    name: "Rat Tail",
    slot: "material", // non-equip slot tag
    maxStack: 99,
    category: "material",
    description: "A grim little trophy from a Town Rat.",
    rarity: "common",
    baseValue: 1,
  },

  rat_meat_raw: {
    id: "rat_meat_raw",
    name: "Stringy Rat Meat",
    slot: "food", // also non-equip
    maxStack: 20,
    category: "food",
    description: "Questionable, but technically edible.",
    rarity: "common",
    baseValue: 1,
  },

  // --- Harvest ---

  ore_iron_hematite: {
    id: "ore_iron_hematite",
    name: "Hematite Ore",
    slot: "material",
    maxStack: 99,
    category: "resource",
    description: "A lump of iron-rich hematite.",
    rarity: "common",
    baseValue: 1,
  },
  
};

export function getItemTemplate(id: string): ItemTemplate | null {
  return ITEMS[id] ?? null;
}

export function listAllItems(): ItemTemplate[] {
  return Object.values(ITEMS);
}