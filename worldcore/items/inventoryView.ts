//worldcore/items/inventoryView.ts

import { formatItemLabel } from "./ItemDisplay";

export function buildInventoryLines(itemsSvc: any | undefined, inv: any): string[] {
  if (!inv) return ["Your inventory is empty."];

  const lines: string[] = [];

  // Currency
  const currency = inv.currency ?? {};
  const keys = Object.keys(currency);
  const hasCurrency = keys.some((k) => Number(currency[k] ?? 0) > 0);

  // Bags
  let hasAnyItems = false;

  if (inv.bags?.length) {
    for (const bag of inv.bags) {
      const bagLines: string[] = [];
      bag.slots.forEach((slot: any, idx: number) => {
        if (!slot) return;
        hasAnyItems = true;
        const itemId = slot.itemId ?? "unknown";
        const qty = slot.qty ?? 1;
        bagLines.push(`  [${idx}] ${formatItemLabel(itemsSvc, itemId)} x${qty}`);
      });

      if (bagLines.length > 0) {
        lines.push(`Bag ${bag.bagId} (size ${bag.size}):`);
        lines.push(...bagLines);
      }
    }
  }

  if (!hasCurrency && !hasAnyItems) return ["Your inventory is empty."];

  lines.unshift(
    hasCurrency
      ? `Currency: ${keys.map(k => `${currency[k]} ${k}`).join(", ")}`
      : "Currency: none"
  );

  return lines;
}
