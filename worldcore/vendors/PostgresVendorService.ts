// worldcore/vendors/PostgresVendorService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

import type { VendorDefinition, VendorItem, VendorItemEconomyConfig } from "./VendorTypes";
import { computeVendorUnitPriceGold } from "./VendorTypes";
import type { GetVendorOptions, VendorService } from "./VendorService";

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
  restock_per_hour: number | null;
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

export class PostgresVendorService implements VendorService {
  private async ensureEconomyRowsForVendor(vendorId: string): Promise<void> {
    // These tables are introduced by migration 046_vendor_economy_realism_v1.sql.
    // If migration isn't applied yet, we just skip economy behavior (the joins will be NULL).
    try {
      await db.query(
        `
        INSERT INTO vendor_item_economy (vendor_item_id)
        SELECT vi.id
        FROM vendor_items vi
        WHERE vi.vendor_id = $1
        ON CONFLICT (vendor_item_id) DO NOTHING
        `,
        [vendorId]
      );

      await db.query(
        `
        INSERT INTO vendor_item_state (vendor_item_id, stock, last_restock_ts)
        SELECT e.vendor_item_id, e.stock_max, NOW()
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
        WITH now_ts AS (SELECT NOW()::timestamptz AS ts)
        UPDATE vendor_item_state s
        SET stock = LEAST(
              e.stock_max,
              s.stock + GREATEST(
                0,
                FLOOR(
                  (EXTRACT(EPOCH FROM ((SELECT ts FROM now_ts) - s.last_restock_ts)) / 3600.0)
                  * e.restock_per_hour
                )::int
              )
            ),
            last_restock_ts = CASE
              WHEN FLOOR(
                (EXTRACT(EPOCH FROM ((SELECT ts FROM now_ts) - s.last_restock_ts)) / 3600.0)
                * e.restock_per_hour
              )::int > 0
              THEN (SELECT ts FROM now_ts)
              ELSE s.last_restock_ts
            END
        FROM vendor_item_economy e
        WHERE e.vendor_item_id = s.vendor_item_id
          AND s.vendor_item_id IN (SELECT id FROM vendor_items WHERE vendor_id = $1)
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

        e.stock_max,
        e.restock_per_hour,
        e.price_min_mult,
        e.price_max_mult,

        s.stock,
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
      const basePriceGold = toInt(row.price_gold, 1);

      // If economy rows are missing (migration not applied), we treat as infinite stock.
      const stockMaxRaw = row.stock_max;
      const stockRaw = row.stock;

      const econ: VendorItemEconomyConfig | null =
        stockMaxRaw == null || row.restock_per_hour == null
          ? null
          : {
              stockMax: toInt(stockMaxRaw, 50),
              restockPerHour: toInt(row.restock_per_hour, 30),
              priceMinMult: toNum(row.price_min_mult, 0.85),
              priceMaxMult: toNum(row.price_max_mult, 1.5),
            };

      const stockMax = econ ? econ.stockMax : null;
      const stock = econ ? toInt(stockRaw, stockMax ?? 0) : null;

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
        SET stock = GREATEST(0, stock - $2)
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
        SET stock = LEAST(e.stock_max, s.stock + $2)
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
