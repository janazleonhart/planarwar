// worldcore/auction/AuctionService.ts

import type { AuctionListing } from "./AuctionTypes";

export interface AuctionBrowseOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuctionService {
  browse(
    shardId: string,
    opts?: AuctionBrowseOptions
  ): Promise<AuctionListing[]>;

  get(id: number): Promise<AuctionListing | null>;

  createListing(args: {
    shardId: string;
    sellerCharId: string;
    sellerCharName: string;
    itemId: string;
    qty: number;
    unitPriceGold: number;
  }): Promise<AuctionListing>;

  /** Mark listing as sold + record proceeds. Returns updated listing or null if not available. */
  buyout(args: {
    id: number;
    shardId: string;
    buyerCharId: string;
    buyerCharName: string;
  }): Promise<AuctionListing | null>;

  /** Seller cancels their own active listing, returns listing or null if not allowed. */
  cancelListing(args: {
    id: number;
    sellerCharId: string;
  }): Promise<AuctionListing | null>;

  listBySeller(args: {
    shardId: string;
    sellerCharId: string;
  }): Promise<AuctionListing[]>;

  /** Mark all unclaimed proceeds for seller as claimed, returning total gold. */
  claimProceeds(args: {
    shardId: string;
    sellerCharId: string;
  }): Promise<number>;

  /** Expire old active auctions for a shard; returns how many rows were affected. */
  expireOld(shardId: string, now: Date): Promise<number>;

  /** 
   * Mark all expired, unreclaimed auctions for this seller as reclaimed and
   * return the listings. Items should then be granted back to the seller.
   */
   reclaimExpiredForSeller(args: {
    shardId: string;
    sellerCharId: string;
  }): Promise<AuctionListing[]>;

}


