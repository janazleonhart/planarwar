// worldcore/vendors/PostgresVendorService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import type { VendorDefinition, VendorItem } from "./VendorTypes";
import type { VendorService } from "./VendorService";

const log = Logger.scope("VENDORS");

interface VendorRow {
  id: string;
  name: string;
}

interface VendorItemRow {
  id: number;
  vendor_id: string;
  item_id: string;
  price_gold: number;
}

export class PostgresVendorService implements VendorService {
  async getVendor(id: string): Promise<VendorDefinition | null> {
    const vRes = await db.query<VendorRow>(
      `SELECT * FROM vendors WHERE id = $1`,
      [id]
    );

    if (vRes.rowCount === 0) return null;
    const v = vRes.rows[0];

    const iRes = await db.query<VendorItemRow>(
      `
      SELECT *
      FROM vendor_items
      WHERE vendor_id = $1
      ORDER BY id ASC
      `,
      [v.id]
    );

    const items: VendorItem[] = iRes.rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      priceGold: row.price_gold,
    }));

    return {
      id: v.id,
      name: v.name,
      items,
    };
  }

  async listVendors(): Promise<{ id: string; name: string }[]> {
    const res = await db.query<VendorRow>(
      `SELECT id, name FROM vendors ORDER BY id ASC`
    );
    return res.rows.map((r) => ({ id: r.id, name: r.name }));
  }
}
