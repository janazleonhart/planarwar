// worldcore/vendors/VendorTypes.ts

export interface VendorItemEconomyConfig {
  stockMax?: number;       // <=0 means infinite
  restockPerHour?: number; // <=0 means no restock
  restockEverySec?: number;     // v1.1 cadence
  restockAmount?: number;       // v1.1 cadence
  priceMinMult?: number;
  priceMaxMult?: number;
}

export interface VendorItem {
  id: number;          // vendor_items row id
  itemId: string;      // e.g. 'herb_peacebloom'
  basePriceGold: number; // DB/base price
  priceGold: number;     // effective current price

  // Null means "infinite" (no stock tracking).
  stock: number | null;
  stockMax: number | null;

  econ: VendorItemEconomyConfig | null;
}

export interface VendorDefinition {
  id: string;   // usually matches an NPC/service proto id
  name: string; // display name
  items: VendorItem[];

  /** Optional alias used by some tests/tools. Prefer `id` in production code. */
  vendorId?: string;
}

export function getVendorId(v: VendorDefinition): string {
  return String((v as any)?.id ?? (v as any)?.vendorId ?? "");
}

export function clampNumber(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Compute the effective unit price for a vendor item given stock ratio.
 *
 * Scarcity increases price as stock approaches 0.
 * Full stock yields a discount (priceMinMult).
 */
export function computeVendorUnitPriceGold(
  basePriceGold: number,
  stock: number | null,
  stockMax: number | null,
  priceMinMult = 0.85,
  priceMaxMult = 1.5
): number {
  const base = Math.max(1, Math.floor(Number(basePriceGold) || 1));

  // Infinite/no-stock path.
  if (stock == null || stockMax == null || stockMax <= 0) return base;

  const max = Math.max(1, Math.floor(stockMax));
  const s = clampNumber(Math.floor(stock), 0, max);

  const minM = clampNumber(Number(priceMinMult) || 0.85, 0.05, 10);
  const maxM = clampNumber(Number(priceMaxMult) || 1.5, 0.05, 10);

  // Ensure sane ordering.
  const lo = Math.min(minM, maxM);
  const hi = Math.max(minM, maxM);

  const ratio = s / max;          // 0..1
  const scarcity = 1 - ratio;     // 1..0
  const mult = lo + (hi - lo) * scarcity;

  return Math.max(1, Math.ceil(base * mult));
}
