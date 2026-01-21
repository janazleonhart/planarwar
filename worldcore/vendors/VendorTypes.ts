// worldcore/vendors/VendorTypes.ts

export interface VendorItem {
  id: number; // row id
  itemId: string; // e.g. 'herb_peacebloom'
  priceGold: number; // cost per unit
}

export interface VendorDefinition {
  id: string; // 'starter_alchemist'
  name: string; // 'Shard Alchemist'
  items: VendorItem[];

  /**
   * Optional alias used by some tests/tools.
   * Prefer `id` in production code.
   */
  vendorId?: string;
}

export function getVendorId(v: VendorDefinition): string {
  return v.id ?? v.vendorId ?? "";
}
