// worldcore/items/resolveItem.ts

import { ItemService } from "./ItemService";
import { getItemTemplate } from "./ItemCatalog";
import { ItemTemplate } from "./ItemTypes";

export function resolveItem(
  items: ItemService,
  itemId: string
): ItemTemplate | null {
  const dbItem = items.get(itemId);
  if (dbItem) {
    return {
      ...dbItem,
      baseValue: dbItem.baseValue ?? undefined,
      category: dbItem.category ?? "misc",
    };
  }

  return getItemTemplate(itemId);
}
