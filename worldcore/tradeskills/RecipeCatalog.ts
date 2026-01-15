// worldcore/tradeskills/RecipeCatalog.ts
//
// PLANAR WAR – Tradeskills v1
// Static recipe list for early crafting experiments.
//
// NOTE: Outputs MUST exist in the DB (items table) because craftCommand checks ctx.items.get(...).
// If an output is missing, crafting hard-fails with “Add it to DB first.”
//
// This catalog is intentionally small; later we’ll migrate recipes into DB tables.

import type { TradeRecipe, RecipeMap } from "./RecipeTypes";

export const RECIPES: RecipeMap = {
  // 5x Hematite Ore -> 1x Crude Iron Bar
  smelt_iron_ingot: {
    id: "smelt_iron_ingot",
    name: "Smelt Iron Ingot",
    category: "smelting",
    description: "Smelt Hematite Ore into a crude iron bar.",
    inputs: [{ itemId: "ore_iron_hematite", qty: 5 }],
    outputs: [{ itemId: "bar_iron_crude", qty: 1 }],
  },

  // 3x Peacebloom -> 1x Minor Healing Draught
  brew_minor_heal: {
    id: "brew_minor_heal",
    name: "Brew Minor Healing Draught",
    category: "alchemy",
    description: "Brew a simple healing draught from Peacebloom.",
    inputs: [{ itemId: "herb_peacebloom", qty: 3 }],
    outputs: [{ itemId: "potion_heal_minor", qty: 1 }],
  },

  // 1x River Trout -> 1x Cooked River Trout
  cook_river_trout: {
    id: "cook_river_trout",
    name: "Cook River Trout",
    category: "cooking",
    description: "Cook a fresh trout into a hearty meal.",
    inputs: [{ itemId: "fish_river_trout", qty: 1 }],
    outputs: [{ itemId: "food_trout_cooked", qty: 1 }],
  },

  // 2x Golden Wheat -> 1x Wheat Flour
  mill_wheat_flour: {
    id: "mill_wheat_flour",
    name: "Mill Wheat Flour",
    category: "cooking",
    description: "Grind wheat into flour for simple baking.",
    inputs: [{ itemId: "grain_wheat", qty: 2 }],
    outputs: [{ itemId: "food_flour_wheat", qty: 1 }],
  },

  // 2x Wheat Flour -> 1x Simple Bread
  bake_simple_bread: {
    id: "bake_simple_bread",
    name: "Bake Simple Bread",
    category: "cooking",
    description: "Bake flour into basic bread. A cornerstone of civilization.",
    inputs: [{ itemId: "food_flour_wheat", qty: 2 }],
    outputs: [{ itemId: "food_bread_simple", qty: 1 }],
  },
};

export function listAllRecipes(): TradeRecipe[] {
  return Object.values(RECIPES);
}

export function getRecipe(id: string): TradeRecipe | undefined {
  return RECIPES[id];
}

/**
 * Try to resolve by id first, then by name (case-insensitive).
 */
export function findRecipeByIdOrName(token: string): TradeRecipe | undefined {
  const byId = RECIPES[token];
  if (byId) return byId;

  const lower = token.toLowerCase();
  for (const r of Object.values(RECIPES)) {
    if (r.name.toLowerCase() === lower) return r;
  }
  return undefined;
}
