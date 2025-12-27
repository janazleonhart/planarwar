// worldcore/tradeskills/RecipeTypes.ts
//
// PLANAR WAR – Tradeskills v1
// Minimal recipe definitions for basic crafting.

export type TradeskillCategory =
  | "alchemy"
  | "smelting"
  | "cooking"
  | "scribing"; // future

export interface RecipeIngredient {
  itemId: string;  // DB-backed item id
  qty: number;     // required count
}

export interface RecipeOutput {
  itemId: string;  // DB-backed item id
  qty: number;
}

export interface TradeRecipe {
  id: string;               // unique id, used in 'craft <id>'
  name: string;             // display name
  category: TradeskillCategory;
  description: string;
  inputs: RecipeIngredient[];
  outputs: RecipeOutput[];

  // Future knobs – leave for v2:
  // minSkill?: number;
  // skillUpChance?: number;
}

export interface RecipeMap {
  [id: string]: TradeRecipe;
}
