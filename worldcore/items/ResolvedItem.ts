//worldcore/items/ResolvedItem.ts

import { ItemTemplate } from "./ItemTypes";
import { ItemDefinition } from "./ItemTypes";

/**
 * Unified runtime item type.
 * Safe for inventory, loot, gameplay.
 */
export type ResolvedItem = Omit<ItemTemplate, "baseValue"> & {
  baseValue?: number;
};
