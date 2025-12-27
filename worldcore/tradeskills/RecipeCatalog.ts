// worldcore/tradeskills/RecipeCatalog.ts
//
// PLANAR WAR – Tradeskills v1
// Static recipe list for early crafting experiments.

import type { TradeRecipe, RecipeMap } from "./RecipeTypes";

export const RECIPES: RecipeMap = {
  // 5x Hematite Ore -> 1x Iron Ingot (simple)
  smelt_iron_ingot: {
    id: "smelt_iron_ingot",
    name: "Smelt Iron Ingot",
    category: "smelting",
    description: "Smelt Hematite Ore into a crude iron ingot.",
    inputs: [
      { itemId: "ore_iron_hematite", qty: 5 },
    ],
    outputs: [
      { itemId: "bar_iron_crude", qty: 1 }, // TODO: add to DB items
    ],
  },

  // 3x Peacebloom -> 1x Minor Healing Draught
  brew_minor_heal: {
    id: "brew_minor_heal",
    name: "Brew Minor Healing Draught",
    category: "alchemy",
    description: "Brew a simple healing draught from Peacebloom.",
    inputs: [
      { itemId: "herb_peacebloom", qty: 3 },
    ],
    outputs: [
      { itemId: "potion_heal_minor", qty: 1 }, // TODO: add to DB items
    ],
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
