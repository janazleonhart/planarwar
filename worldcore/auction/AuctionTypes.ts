// worldcore/auction/AuctionTypes.ts

export type AuctionStatus = "active" | "sold" | "cancelled" | "expired";

export interface AuctionListing {
  id: number;
  shardId: string;

  sellerCharId: string;
  sellerCharName: string;

  itemId: string;
  qty: number;
  unitPriceGold: number;
  totalPriceGold: number;

  status: AuctionStatus;
  createdAt: string;

  buyerCharId?: string | null;
  buyerCharName?: string | null;
  soldAt?: string | null;

  proceedsGold?: number | null;
  proceedsClaimed?: boolean | null;
}
