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
    expiresAt: row.expires_at ? row.expires_at.toISOString() : undefined,
    itemsReclaimed: row.items_reclaimed ?? undefined,
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

  async revertFailedCreateListing(args: {
    id: number;
    shardId: string;
    sellerCharId: string;
  }): Promise<boolean> {
    const res = await db.query(
      `
      DELETE FROM auctions
      WHERE id = $1
        AND shard_id = $2
        AND seller_char_id = $3
        AND status = 'active'
        AND buyer_char_id IS NULL
        AND proceeds_gold IS NULL
    `,
      [args.id, args.shardId, args.sellerCharId]
    );

    return (res.rowCount ?? 0) > 0;
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
        AND seller_char_id <> $3
      RETURNING *
    `,
      [args.id, args.shardId, args.buyerCharId, args.buyerCharName]
    );

    if (res.rowCount === 0) return null;
    return rowToListing(res.rows[0] as AuctionRow);
  }

  async cancelListing(args: {
    id: number;
    shardId: string;
    sellerCharId: string;
  }): Promise<AuctionListing | null> {
    const res = await db.query(
      `
      UPDATE auctions
      SET status = 'cancelled'
      WHERE id = $1
        AND shard_id = $2
        AND seller_char_id = $3
        AND status = 'active'
      RETURNING *
    `,
      [args.id, args.shardId, args.sellerCharId]
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

  async revertFailedBuyout(args: {
    id: number;
    shardId: string;
    buyerCharId: string;
  }): Promise<AuctionListing | null> {
    const res = await db.query(
      `
      UPDATE auctions
      SET status = 'active',
          buyer_char_id = NULL,
          buyer_char_name = NULL,
          sold_at = NULL,
          proceeds_gold = NULL
      WHERE id = $1
        AND shard_id = $2
        AND status = 'sold'
        AND buyer_char_id = $3
        AND proceeds_claimed = false
      RETURNING *
    `,
      [args.id, args.shardId, args.buyerCharId]
    );

    if (res.rowCount === 0) return null;
    return rowToListing(res.rows[0] as AuctionRow);
  }

  async claimProceeds(args: {
    shardId: string;
    sellerCharId: string;
  }): Promise<{ listingIds: number[]; total: number }> {
    const res = await db.query(
      `
      WITH claimed AS (
        UPDATE auctions
        SET proceeds_claimed = true
        WHERE shard_id = $1
          AND seller_char_id = $2
          AND status = 'sold'
          AND proceeds_gold IS NOT NULL
          AND proceeds_claimed = false
        RETURNING id, proceeds_gold
      )
      SELECT COALESCE(array_agg(id), '{}') AS listing_ids,
             COALESCE(SUM(proceeds_gold), 0) AS total
      FROM claimed
    `,
      [args.shardId, args.sellerCharId]
    );

    const row =
      (res.rows[0] as
        | { listing_ids?: number[] | null; total: string | number | null }
        | undefined) ?? undefined;
    const totalRaw = row?.total;
    const total = typeof totalRaw === "number" ? totalRaw : Number(totalRaw ?? 0);
    const listingIds = Array.isArray(row?.listing_ids)
      ? row!.listing_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : [];

    return {
      listingIds,
      total: Number.isFinite(total) && total > 0 ? total : 0,
    };
  }

  async revertFailedClaimProceeds(args: {
    shardId: string;
    sellerCharId: string;
    listingIds: number[];
  }): Promise<number> {
    if (args.listingIds.length === 0) return 0;

    const res = await db.query(
      `
      UPDATE auctions
      SET proceeds_claimed = false
      WHERE shard_id = $1
        AND seller_char_id = $2
        AND id = ANY($3::int[])
        AND status = 'sold'
        AND proceeds_gold IS NOT NULL
        AND proceeds_claimed = true
    `,
      [args.shardId, args.sellerCharId, args.listingIds]
    );

    return res.rowCount ?? 0;
  }

  async reclaimExpiredListing(args: {
    id: number;
    shardId: string;
    sellerCharId: string;
  }): Promise<AuctionListing | null> {
    const res = await db.query(
      `
      UPDATE auctions
      SET items_reclaimed = true
      WHERE id = $1
        AND shard_id = $2
        AND seller_char_id = $3
        AND status = 'expired'
        AND items_reclaimed = false
      RETURNING *
    `,
      [args.id, args.shardId, args.sellerCharId]
    );

    if (res.rowCount === 0) return null;
    return rowToListing(res.rows[0] as AuctionRow);
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
