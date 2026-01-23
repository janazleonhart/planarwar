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

export type VendorRestockCadenceResult = {
  tickSec: number;
  tickAmount: number;
  ticks: number;
  newStock: number;
  newLastRestockMs: number;
};

/**
 * Pure restock cadence math that mirrors the SQL logic used by PostgresVendorService.
 *
 * SQL semantics (mirrored):
 * - Determine tick_sec/tick_amount from cadence fields, else approximate from restockPerHour.
 * - ticks = floor((now - last) / tick_sec)
 * - stock += ticks * tick_amount, capped at stockMax
 * - lastRestock advances by ticks * tick_sec (even if stock was already full)
 */
export function computeVendorRestockCadence(args: {
  stock: number;
  stockMax: number;
  lastRestockMs: number;
  nowMs: number;
  restockEverySec?: number | null;
  restockAmount?: number | null;
  restockPerHour?: number | null;
}): VendorRestockCadenceResult {
  const stockMax = Math.max(0, Math.floor(Number(args.stockMax) || 0));
  const stock = clampNumber(Math.floor(Number(args.stock) || 0), 0, stockMax > 0 ? stockMax : 0);

  const last = Number(args.lastRestockMs);
  const now = Number(args.nowMs);

  const everySec = Math.floor(Number(args.restockEverySec ?? 0) || 0);
  const amount = Math.floor(Number(args.restockAmount ?? 0) || 0);
  const perHour = Math.floor(Number(args.restockPerHour ?? 0) || 0);

  let tickSec = 0;
  let tickAmount = 0;

  if (everySec > 0 && amount > 0) {
    tickSec = everySec;
    tickAmount = amount;
  } else if (perHour > 0) {
    tickSec = Math.max(1, Math.floor(3600 / perHour));
    tickAmount = 1;
  }

  const elapsedMs = Number.isFinite(now) && Number.isFinite(last) ? Math.max(0, now - last) : 0;
  const ticks = tickSec > 0 && tickAmount > 0 ? Math.floor(elapsedMs / (tickSec * 1000)) : 0;

  const newLastRestockMs = ticks > 0 && tickSec > 0 ? last + ticks * tickSec * 1000 : last;
  const newStock = stockMax > 0 ? Math.min(stockMax, stock + ticks * tickAmount) : stock;

  return {
    tickSec,
    tickAmount,
    ticks,
    newStock,
    newLastRestockMs,
  };
}
