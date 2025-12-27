//worldcore/loot/lootText.ts

export function describeLootLine(
    itemId: string,
    qty: number,
    itemName?: string
  ): string {
    const name = itemName ?? itemId;
    const qtyText = qty > 1 ? `${qty}x ` : "";
    const q = Math.max(0, Math.floor(qty));
    if (q <= 0) return itemName ?? itemId;
    return `${qtyText}${name}`;
}