// worldcore/auction/AuctionFormat.ts

import type { AuctionListing } from "./AuctionTypes";
import type { MudContext } from "../mud/MudContext";

/**
 * Formats a single auction listing as a one-line MUD string.
 * Example:
 *   #12 Hematite Iron Ore [common] x20 – 3g each (total 60g) by Testing [active]
 */
export function formatAuctionListing(
  listing: AuctionListing,
  ctx: MudContext
): string {
  const def = ctx.items?.get(listing.itemId);
  const name = def?.name ?? listing.itemId;
  const rarity = def?.rarity ?? "common";
  const status = listing.status;
  const unit = listing.unitPriceGold;
  const total = listing.totalPriceGold;

  return `#${listing.id} ${name} [${rarity}] x${listing.qty} – ${unit}g each (total ${total}g) by ${listing.sellerCharName} [${status}]`;
}
