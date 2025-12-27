// worldcore/items/ItemEconomy.ts

import { getItemTemplate } from "./ItemCatalog";

/**
 * Return the base sell value for an item in gold.
 *
 * For now, we read `baseValue` off the item template if present.
 * If not set or <= 0, the item is unsellable.
 */
export function getItemSellValue(itemId: string): number {
  const tmpl = getItemTemplate(itemId);
  if (!tmpl) return 0;

  const anyT = tmpl as any;
  if (typeof anyT.baseValue === "number" && anyT.baseValue > 0) {
    return anyT.baseValue;
  }

  // Future: fallbacks based on category/rarity if needed.
  return 0;
}
