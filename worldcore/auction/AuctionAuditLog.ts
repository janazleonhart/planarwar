// worldcore/auction/AuctionAuditLog.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import type { AuctionListing } from "./AuctionTypes";

const log = Logger.scope("AUCTION_AUDIT");

export type AuctionAction =
  | "create"
  | "buy"
  | "cancel"
  | "expire"
  | "claim"
  | "reclaim";

export async function logAuctionEvent(opts: {
  shardId: string;
  listing: AuctionListing;
  action: AuctionAction;
  actorCharId?: string;
  actorCharName?: string;
  details?: Record<string, any>;
}): Promise<void> {
  try {
    await db.query(
      `
      INSERT INTO auction_log (
        shard_id,
        listing_id,
        actor_char_id,
        actor_char_name,
        action,
        details
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
      `,
      [
        opts.shardId,
        opts.listing.id,
        opts.actorCharId ?? null,
        opts.actorCharName ?? null,
        opts.action,
        JSON.stringify(opts.details ?? {}),
      ]
    );
  } catch (err) {
    log.warn("Failed to write auction_log row", {
      err: String(err),
      action: opts.action,
      listingId: opts.listing.id,
    });
  }
}
