// worldcore/auction/PostgresAuctionService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import type { AuctionListing, AuctionStatus } from "./AuctionTypes";
import type { AuctionService, AuctionBrowseOptions } from "./AuctionService";

const log = Logger.scope("AUCTION");

interface AuctionRow {
  id: number;
  shard_id: string;
  seller_char_id: string;
  seller_char_name: string;
  item_id: string;
  qty: number;
  unit_price_gold: number;
  total_price_gold: number;
  status: AuctionStatus;
  created_at: Date;
  buyer_char_id: string | null;
  buyer_char_name: string | null;
  sold_at: Date | null;
  proceeds_gold: number | null;
  proceeds_claimed: boolean;
  expires_at?: Date | null;
  items_reclaimed?: boolean | null;
}

function rowToListing(row: AuctionRow): AuctionListing {
  return {
    id: row.id,
    shardId: row.shard_id,
    sellerCharId: row.seller_char_id,
    sellerCharName: row.seller_char_name,
    itemId: row.item_id,
    qty: row.qty,
    unitPriceGold: row.unit_price_gold,
    totalPriceGold: row.total_price_gold,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    buyerCharId: row.buyer_char_id,
    buyerCharName: row.buyer_char_name,
    soldAt: row.sold_at ? row.sold_at.toISOString() : undefined,
    proceedsGold: row.proceeds_gold ?? undefined,
    proceedsClaimed: row.proceeds_claimed,
  };
}

export class PostgresAuctionService implements AuctionService {
  async browse(
    shardId: string,
    opts: AuctionBrowseOptions = {}
  ): Promise<AuctionListing[]> {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const search = opts.search?.trim();

    if (search) {
      const res = await db.query(
        `
        SELECT *
        FROM auctions
        WHERE shard_id = $1
          AND status = 'active'
          AND item_id ILIKE $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
      `,
        [shardId, `%${search}%`, limit, offset]
      );

      return (res.rows as AuctionRow[]).map(rowToListing);
    }

    const res = await db.query(
      `
      SELECT *
      FROM auctions
      WHERE shard_id = $1
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
      [shardId, limit, offset]
    );

    return (res.rows as AuctionRow[]).map(rowToListing);
  }

  async get(id: number): Promise<AuctionListing | null> {
    const res = await db.query(
      `SELECT * FROM auctions WHERE id = $1`,
      [id]
    );

    if (res.rowCount === 0) return null;
    return rowToListing(res.rows[0] as AuctionRow);
  }

  async createListing(args: {
    shardId: string;
    sellerCharId: string;
    sellerCharName: string;
    itemId: string;
    qty: number;
    unitPriceGold: number;
  }): Promise<AuctionListing> {
    const total = args.qty * args.unitPriceGold;
    const ttlDays = 3; // tune this later

    const res = await db.query(
      `
      INSERT INTO auctions (
        shard_id,
        seller_char_id,
        seller_char_name,
        item_id,
        qty,
        unit_price_gold,
        total_price_gold,
        status,
        expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active', now() + $8::interval)
      RETURNING *
    `,
      [
        args.shardId,
        args.sellerCharId,
        args.sellerCharName,
        args.itemId,
        args.qty,
        args.unitPriceGold,
        total,
        `${ttlDays} days`,
      ]
    );

    return rowToListing(res.rows[0] as AuctionRow);
  }

  async buyout(args: {
    id: number;
    shardId: string;
    buyerCharId: string;
    buyerCharName: string;
  }): Promise<AuctionListing | null> {
    const res = await db.query(
      `
      UPDATE auctions
      SET status = 'sold',
          buyer_char_id = $3,
          buyer_char_name = $4,
          sold_at = now(),
          proceeds_gold = total_price_gold
      WHERE id = $1
        AND shard_id = $2
        AND status = 'active'
      RETURNING *
    `,
    [args.id, args.shardId, args.buyerCharId, args.buyerCharName]
    );

    if (res.rowCount === 0) return null;
    return rowToListing(res.rows[0] as AuctionRow);
  }

  async cancelListing(args: {
    id: number;
    sellerCharId: string;
  }): Promise<AuctionListing | null> {
    const res = await db.query(
      `
      UPDATE auctions
      SET status = 'cancelled'
      WHERE id = $1
        AND seller_char_id = $2
        AND status = 'active'
      RETURNING *
    `,
      [args.id, args.sellerCharId]
    );

    if (res.rowCount === 0) return null;
    return rowToListing(res.rows[0] as AuctionRow);
  }

  async listBySeller(args: {
    shardId: string;
    sellerCharId: string;
  }): Promise<AuctionListing[]> {
    const res = await db.query(
      `
      SELECT *
      FROM auctions
      WHERE shard_id = $1
        AND seller_char_id = $2
      ORDER BY created_at DESC
    `,
      [args.shardId, args.sellerCharId]
    );

    return (res.rows as AuctionRow[]).map(rowToListing);
  }

  async claimProceeds(args: {
    shardId: string;
    sellerCharId: string;
  }): Promise<number> {
    const sumRes = await db.query(
      `
      SELECT SUM(proceeds_gold) AS sum
      FROM auctions
      WHERE shard_id = $1
        AND seller_char_id = $2
        AND status = 'sold'
        AND proceeds_gold IS NOT NULL
        AND proceeds_claimed = false
    `,
      [args.shardId, args.sellerCharId]
    );

    const sumRow = sumRes.rows[0] as { sum: string | null } | undefined;
    const sumStr = sumRow?.sum;
    const total = sumStr ? Number(sumStr) : 0;

    if (!total || total <= 0) {
      return 0;
    }

    await db.query(
      `
      UPDATE auctions
      SET proceeds_claimed = true
      WHERE shard_id = $1
        AND seller_char_id = $2
        AND status = 'sold'
        AND proceeds_gold IS NOT NULL
        AND proceeds_claimed = false
    `,
      [args.shardId, args.sellerCharId]
    );

    return total;
  }

  async expireOld(shardId: string, now: Date): Promise<number> {
    const res = await db.query(
      `
      UPDATE auctions
      SET status = 'expired'
      WHERE shard_id = $1
        AND status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at <= $2
    `,
      [shardId, now]
    );

    // rowCount is the simplest here.
    return res.rowCount ?? 0;
  }

  async reclaimExpiredForSeller(args: {
    shardId: string;
    sellerCharId: string;
  }): Promise<AuctionListing[]> {
    const res = await db.query(
      `
      UPDATE auctions
      SET items_reclaimed = true
      WHERE shard_id = $1
        AND seller_char_id = $2
        AND status = 'expired'
        AND items_reclaimed = false
      RETURNING *
    `,
      [args.shardId, args.sellerCharId]
    );

    return (res.rows as AuctionRow[]).map(rowToListing);
  }
}
