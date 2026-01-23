// worldcore/vendors/PostgresVendorService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

import type { VendorDefinition, VendorItem, VendorItemEconomyConfig } from "./VendorTypes";
import { computeVendorUnitPriceGold } from "./VendorTypes";
import type { GetVendorOptions, VendorService } from "./VendorService";
import { getVendorEconomyPolicyForTier, tryInferTownTierFromIdToken } from "../world/TownTierRules";

const log = Logger.scope("VENDORS");

interface VendorRow {
  id: string;
  name: string;
}

interface VendorItemJoinedRow {
  id: number;
  vendor_id: string;
  item_id: string;
  price_gold: number;

  stock_max: number | null;
  restock_per_hour: number | null;      // legacy
  restock_every_sec: number | null;     // v1.1 cadence
  restock_amount: number | null;        // v1.1 cadence
  price_min_mult: string | number | null;
  price_max_mult: string | number | null;

  stock: number | null;
  last_restock_ts: string | null;
}

function toInt(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function toNum(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}


export class PostgresVendorService implements VendorService {
  private async ensureEconomyRowsForVendor(vendorId: string): Promise<void> {
    // These tables are introduced by migration 046_vendor_economy_realism_v1.sql.
    // If migration isn't applied yet, we just skip economy behavior (the joins will be NULL).
    try {
      // Tier-aware defaults (v1.1). If the vendor id includes a tier token
      // (tier_3, tier-3, etc), we apply that tier's defaults. Otherwise, tier 1.
      const inferredTier = tryInferTownTierFromIdToken(vendorId) ?? 1;
      const policy = getVendorEconomyPolicyForTier(inferredTier);
      // Defensive sanity: keep DB writes and pricing math within reasonable bounds.
      const saneStockMax = clamp(toInt((policy as any).stockMax ?? (policy as any).stockMax, 50), 0, 1000000);
      const saneRestockEverySec = clamp(toInt((policy as any).restockEverySec ?? 0, 0), 0, 31536000);
      const saneRestockAmount = clamp(toInt((policy as any).restockAmount ?? 0, 0), 0, 1000000);
      const sanePriceMinMult = clamp(toNum((policy as any).priceMinMult ?? 0.85, 0.85), 0.01, 100);
      const sanePriceMaxMult = clamp(toNum((policy as any).priceMaxMult ?? 1.5, 1.5), 0.01, 100);


      // Defensive sanity: keep DB writes and pricing math within reasonable bounds.
      const sane = {
        stockMax: clamp(toInt((policy as any).stockMax, 50), 0, 1000000),
        restockEverySec: clamp(toInt((policy as any).restockEverySec, 0), 0, 31536000),
        restockAmount: clamp(toInt((policy as any).restockAmount, 0), 0, 1000000),
        priceMinMult: clamp(toNum((policy as any).priceMinMult, 0.85), 0.01, 100),
        priceMaxMult: clamp(toNum((policy as any).priceMaxMult, 1.5), 0.01, 100),
      };


      // Keep legacy restock_per_hour in sync for older code paths/tools.
      const derivedPerHour = policy.restockEverySec > 0
        ? Math.max(0, Math.floor((3600 / policy.restockEverySec) * Math.max(0, policy.restockAmount)))
        : 0;

      await db.query(
        `
        INSERT INTO vendor_item_economy (
          vendor_item_id,
          stock_max,
          restock_per_hour,
          restock_every_sec,
          restock_amount,
          price_min_mult,
          price_max_mult
        )
        SELECT
          vi.id,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7
        FROM vendor_items vi
        WHERE vi.vendor_id = $1
        ON CONFLICT (vendor_item_id) DO NOTHING
        `,
        [
          vendorId,
          policy.stockMax,
          derivedPerHour,
          policy.restockEverySec,
          policy.restockAmount,
          policy.priceMinMult,
          policy.priceMaxMult,
        ]
      );

      // Best-effort: apply tier defaults to rows that are still at migration defaults.
      // We intentionally avoid overwriting any hand-tuned economy knobs.
      await db.query(
        `
        UPDATE vendor_item_economy e
        SET
          stock_max = CASE WHEN e.stock_max = 50 THEN $2 ELSE e.stock_max END,
          restock_per_hour = CASE WHEN e.restock_per_hour = 30 THEN $3 ELSE e.restock_per_hour END,
          restock_every_sec = CASE
            WHEN e.restock_every_sec IS NULL OR e.restock_every_sec = 0 THEN $4
            ELSE e.restock_every_sec
          END,
          restock_amount = CASE
            WHEN e.restock_amount IS NULL OR e.restock_amount = 0 THEN $5
            ELSE e.restock_amount
          END,
          price_min_mult = CASE WHEN e.price_min_mult = 0.850 THEN $6 ELSE e.price_min_mult END,
          price_max_mult = CASE WHEN e.price_max_mult = 1.500 THEN $7 ELSE e.price_max_mult END
        WHERE e.vendor_item_id IN (SELECT id FROM vendor_items WHERE vendor_id = $1)
        `,
        [
          vendorId,
          policy.stockMax,
          derivedPerHour,
          policy.restockEverySec,
          policy.restockAmount,
          policy.priceMinMult,
          policy.priceMaxMult,
        ]
      );

      await db.query(
        `
        INSERT INTO vendor_item_state (vendor_item_id, stock, last_restock_ts)
        SELECT e.vendor_item_id,              GREATEST(0, COALESCE(e.stock_max, 0)) AS stock_max, NOW()
        FROM vendor_item_economy e
        JOIN vendor_items vi ON vi.id = e.vendor_item_id
        WHERE vi.vendor_id = $1
        ON CONFLICT (vendor_item_id) DO NOTHING
        `,
        [vendorId]
      );
    } catch (err: any) {
      // Table may not exist (migration not applied yet) or other transient error.
      log.warn("ensureEconomyRowsForVendor failed; continuing without economy realism", {
        vendorId,
        err: err?.message ?? String(err),
      });
    }
  }

  private async restockVendorItems(vendorId: string): Promise<void> {
    // Restock is best-effort and intentionally simple:
    // - compute delta = floor(elapsedHours * restock_per_hour)
    // - apply delta to stock, cap at stock_max
    // - if delta > 0, set last_restock_ts = NOW()
    try {
      await db.query(
        `
        WITH
          now_ts AS (SELECT NOW()::timestamptz AS ts),
          candidates AS (
            SELECT
              s.vendor_item_id,
              COALESCE(s.stock, 0) AS stock,
              COALESCE(s.last_restock_ts, (SELECT ts FROM now_ts)) AS last_restock_ts,
              GREATEST(0, COALESCE(e.stock_max, 0)) AS stock_max,
              COALESCE(NULLIF(e.restock_every_sec, 0), 0) AS restock_every_sec,
              COALESCE(NULLIF(e.restock_amount, 0), 0) AS restock_amount,
              COALESCE(NULLIF(e.restock_per_hour, 0), 0) AS restock_per_hour
            FROM vendor_item_state s
            JOIN vendor_item_economy e ON e.vendor_item_id = s.vendor_item_id
            WHERE s.vendor_item_id IN (SELECT id FROM vendor_items WHERE vendor_id = $1)
          ),
          calc AS (
            SELECT
              c.vendor_item_id,
              c.stock,
              c.last_restock_ts,
              c.stock_max,
              -- Prefer cadence fields if present; otherwise approximate cadence from legacy per-hour.
              CASE
                WHEN c.restock_every_sec > 0 AND c.restock_amount > 0 THEN c.restock_every_sec
                WHEN c.restock_per_hour > 0 THEN GREATEST(1, FLOOR(3600.0 / c.restock_per_hour)::int)
                ELSE 0
              END AS tick_sec,
              CASE
                WHEN c.restock_every_sec > 0 AND c.restock_amount > 0 THEN c.restock_amount
                WHEN c.restock_per_hour > 0 THEN 1
                ELSE 0
              END AS tick_amount
            FROM candidates c
          ),
          deltas AS (
            SELECT
              vendor_item_id,
              stock,
              last_restock_ts,
              stock_max,
              tick_sec,
              tick_amount,
              CASE
                WHEN tick_sec <= 0 OR tick_amount <= 0 THEN 0
                ELSE FLOOR(EXTRACT(EPOCH FROM ((SELECT ts FROM now_ts) - last_restock_ts)) / tick_sec)::int
              END AS ticks
            FROM calc
          )
        UPDATE vendor_item_state s
        SET
          stock = LEAST(d.stock_max, d.stock + (d.ticks * d.tick_amount)),
          last_restock_ts = CASE
            WHEN d.ticks > 0 AND d.tick_sec > 0 THEN d.last_restock_ts + (d.ticks * d.tick_sec) * INTERVAL '1 second'
            ELSE d.last_restock_ts
          END
        FROM deltas d
        WHERE s.vendor_item_id = d.vendor_item_id
        `,
        [vendorId]
      );
    } catch {
      // If economy tables aren't present, ignore.
    }
  }

  async getVendor(id: string, opts?: GetVendorOptions): Promise<VendorDefinition | null> {
    const vRes = await db.query(`SELECT * FROM vendors WHERE id = $1`, [id]);
    if (vRes.rowCount === 0) return null;

    const v = vRes.rows[0] as VendorRow;

    const wantEconomy = !!opts?.forTrade;
    if (wantEconomy) {
      await this.ensureEconomyRowsForVendor(v.id);
      await this.restockVendorItems(v.id);
    }

    let iRes: any;
    try {
      iRes = await db.query(
        `
      SELECT
        vi.id,
        vi.vendor_id,
        vi.item_id,
        vi.price_gold,

              GREATEST(0, COALESCE(e.stock_max, 0)) AS stock_max,
        e.restock_per_hour,
        e.restock_every_sec,
        e.restock_amount,
        e.price_min_mult,
        e.price_max_mult,

              COALESCE(s.stock, 0) AS stock,
        s.last_restock_ts
      FROM vendor_items vi
      LEFT JOIN vendor_item_economy e ON e.vendor_item_id = vi.id
      LEFT JOIN vendor_item_state s ON s.vendor_item_id = vi.id
      WHERE vi.vendor_id = $1
      ORDER BY vi.id ASC
      `,
        [v.id]
      );
    } catch {
      // Economy tables may not exist yet (migrations not applied). Fall back to legacy vendor_items.
      iRes = await db.query(
        `
        SELECT vi.id, vi.vendor_id, vi.item_id, vi.price_gold
        FROM vendor_items vi
        WHERE vi.vendor_id = $1
        ORDER BY vi.id ASC
        `,
        [v.id]
      );
    }


    const items: VendorItem[] = (iRes.rows as VendorItemJoinedRow[]).map((row) => {
      const basePriceGold = clamp(toInt(row.price_gold, 1), 0, 1000000000);

      // If economy rows are missing (migration not applied), we treat as infinite stock.
      const stockMaxRaw = row.stock_max;
      const stockRaw = row.stock;

      const econ: VendorItemEconomyConfig | null =
        stockMaxRaw == null || (row.restock_per_hour == null && row.restock_every_sec == null)
          ? null
          : {
              stockMax: toInt(stockMaxRaw, 50),
              restockPerHour: row.restock_per_hour == null ? undefined : toInt(row.restock_per_hour, 30),
              restockEverySec: row.restock_every_sec == null ? undefined : toInt(row.restock_every_sec, 0),
              restockAmount: row.restock_amount == null ? undefined : toInt(row.restock_amount, 0),
              priceMinMult: toNum(row.price_min_mult, 0.85),
              priceMaxMult: toNum(row.price_max_mult, 1.5),
            };

      const stockMax = econ?.stockMax ?? null;
      const stock = econ ? toInt((stockRaw ?? stockMax ?? 0), stockMax ?? 0) : null;

      const priceGold = wantEconomy
        ? computeVendorUnitPriceGold(
            basePriceGold,
            stock,
            stockMax,
            econ?.priceMinMult ?? 0.85,
            econ?.priceMaxMult ?? 1.5
          )
        : basePriceGold;

      return {
        id: row.id,
        itemId: row.item_id,
        basePriceGold,
        priceGold,
        stock,
        stockMax,
        econ,
      };
    });

    return { id: v.id, name: v.name, items };
  }

  async listVendors(): Promise<{ id: string; name: string }[]> {
    const res = await db.query(`SELECT id, name FROM vendors ORDER BY id ASC`);
    return (res.rows as VendorRow[]).map((r) => ({ id: r.id, name: r.name }));
  }

  async applyPurchase(vendorItemRowId: number, quantity: number): Promise<void> {
    const qty = toInt(quantity, 0);
    if (qty <= 0) return;

    try {
      await db.query(
        `
        UPDATE vendor_item_state
        SET stock = GREATEST(0, COALESCE(stock, 0) - $2)
        WHERE vendor_item_id = $1
        `,
        [vendorItemRowId, qty]
      );
    } catch {
      // ignore (migration missing or transient DB issue)
    }
  }

  async applySale(vendorItemRowId: number, quantity: number): Promise<void> {
    const qty = toInt(quantity, 0);
    if (qty <= 0) return;

    try {
      await db.query(
        `
        UPDATE vendor_item_state s
        SET stock = LEAST(COALESCE(e.stock_max, 0), COALESCE(s.stock, 0) + $2)
        FROM vendor_item_economy e
        WHERE s.vendor_item_id = $1
          AND e.vendor_item_id = s.vendor_item_id
        `,
        [vendorItemRowId, qty]
      );
    } catch {
      // ignore
    }
  }
}
