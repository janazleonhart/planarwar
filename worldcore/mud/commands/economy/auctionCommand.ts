// worldcore/mud/commands/auctionCommand.ts

import {
  getCharacterGold,
  setCharacterGold,
  giveGold,
  giveItemsToCharacter,
} from "../../../economy/EconomyHelpers";
import { logAuctionEvent } from "../../../auction/AuctionAuditLog";
import { formatAuctionListing } from "../../../auction/AuctionFormat";

export async function handleAuctionCommand(
  ctx: any,
  char: any,
  parts: string[]
): Promise<string> {
  if (!ctx.auctions) return "Auction House service is not available.";
  if (!ctx.items) return "Item service is not available.";
  if (!ctx.characters) return "Character service is not available.";

  const sub = (parts[1] || "").toLowerCase();
  const shardId = (char as any).shardId || "prime_shard";

  if (!sub || sub === "help") {
    return [
      "Auction House commands:",
      " ah browse [search]      - list active auctions (optionally filtered by itemId)",
      " ah sell <bag> <slot> <qty> <priceEach> - list an item for sale",
      " ah buy <listingId>      - buy an auction (buyout)",
      " ah my                   - show your auctions",
      " ah claim                - claim gold from sold auctions",
      " ah reclaim              - reclaim items from your expired auctions",
      " ah cancel <listingId>   - cancel one of your active auctions",
      " ah expire               - (staff) expire old auctions",
    ].join("\n");
  }

  // ah browse [search]
  if (sub === "browse") {
    const search = parts.slice(2).join(" ").trim() || undefined;
    const listings = await ctx.auctions.browse(shardId, {
      search,
      limit: 20,
      offset: 0,
    });

    if (listings.length === 0) return "No active auctions found.";

    const lines: string[] = [];
    lines.push("Active auctions:");
    for (const l of listings) lines.push(" " + formatAuctionListing(l, ctx));
    return lines.join("\n");
  }

  // ah sell <bagIndex> <slotIndex> <qty> <priceEach>
  if (sub === "sell") {
    const bagIndex = Number(parts[2] ?? "-1");
    const slotIndex = Number(parts[3] ?? "-1");
    const qtyStr = parts[4];
    const priceStr = parts[5];

    if (
      !Number.isInteger(bagIndex) ||
      !Number.isInteger(slotIndex) ||
      !qtyStr ||
      !priceStr
    ) {
      return "Usage: ah sell <bagIndex> <slotIndex> <qty> <priceEach>";
    }

    const qty = Number(qtyStr);
    const priceEach = Number(priceStr);
    if (qty <= 0 || priceEach <= 0) {
      return "Quantity and price must be positive numbers.";
    }

    const bag = char.inventory.bags[bagIndex];
    if (!bag) return "Invalid bag index.";
    const slot = bag.slots[slotIndex];
    if (!slot) return "That inventory slot is empty.";
    if (slot.qty < qty) {
      return `You only have ${slot.qty} of that item in that slot.`;
    }

    // Only DB-backed items for AH v1
    const def = ctx.items.get(slot.itemId);
    if (!def) return "Only DB-backed items can be auctioned.";

    // Remove from inventory (direct slot manipulation is fine here)
    if (qty === slot.qty) bag.slots[slotIndex] = null;
    else slot.qty -= qty;

    const listing = await ctx.auctions.createListing({
      shardId,
      sellerCharId: (char as any).id,
      sellerCharName: (char as any).name,
      itemId: def.id,
      qty,
      unitPriceGold: priceEach,
    });

    await logAuctionEvent({
      shardId,
      listing,
      action: "create",
      actorCharId: (char as any).id,
      actorCharName: (char as any).name,
      details: {
        qty,
        unitPriceGold: priceEach,
        totalPriceGold: listing.totalPriceGold,
      },
    });

    await ctx.characters.saveCharacter(char);

    return `Created auction #${listing.id}: ${def.name} x${qty} for ${priceEach}g each (total ${listing.totalPriceGold}g).`;
  }

  // ah buy <listingId>
  if (sub === "buy") {
    const idStr = parts[2];
    if (!idStr) return "Usage: ah buy <listingId>";
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return "Invalid listing id.";

    const listing = await ctx.auctions.get(id);
    if (
      !listing ||
      listing.status !== "active" ||
      listing.shardId !== shardId
    ) {
      return "That auction is not available.";
    }

    const def = ctx.items.get(listing.itemId);
    if (!def) return "Auction refers to an unknown item.";

    const price = listing.totalPriceGold;
    const currentGold = getCharacterGold(char);
    if (currentGold < price) {
      return `You do not have enough gold. You need ${price}, but have ${currentGold}.`;
    }

    const updated = await ctx.auctions.buyout({
      id: listing.id,
      shardId,
      buyerCharId: (char as any).id,
      buyerCharName: (char as any).name,
    });
    if (!updated || updated.status !== "sold") {
      return "That auction was just bought or cancelled by someone else.";
    }

    await logAuctionEvent({
      shardId,
      listing: updated,
      action: "buy",
      actorCharId: (char as any).id,
      actorCharName: (char as any).name,
      details: { priceGold: price },
    });

    setCharacterGold(char, currentGold - price);
    await ctx.characters.saveCharacter(char);

    // Deliver via mail (v1)
    if (ctx.mail && ctx.session.identity) {
      await ctx.mail.sendSystemMail(
        ctx.session.identity.userId,
        "account",
        "Auction purchase",
        `You bought ${listing.qty}x ${def.name} for ${price} gold from ${listing.sellerCharName}.`,
        [{ itemId: def.id, qty: listing.qty }]
      );
    }

    return `You bought ${listing.qty}x ${def.name} for ${price} gold. The items have been mailed to you.`;
  }

  // ah my
  if (sub === "my") {
    const listings = await ctx.auctions.listBySeller({
      shardId,
      sellerCharId: (char as any).id,
    });
    if (listings.length === 0) return "You have no auctions.";

    const lines: string[] = [];
    lines.push("Your auctions:");
    for (const l of listings) {
      const base = formatAuctionListing(l, ctx);
      if (l.status === "sold" && l.proceedsGold && !l.proceedsClaimed) {
        lines.push(" " + base + " [UNCLAIMED]");
      } else {
        lines.push(" " + base);
      }
    }
    return lines.join("\n");
  }

  // ah claim
  if (sub === "claim") {
    const total = await ctx.auctions.claimProceeds({
      shardId,
      sellerCharId: (char as any).id,
    });
    if (total <= 0) return "You have no auction proceeds to claim.";

    giveGold(char, total);
    await ctx.characters.saveCharacter(char);

    await logAuctionEvent({
      shardId,
      listing: {
        id: 0,
        shardId,
        sellerCharId: (char as any).id,
        sellerCharName: (char as any).name,
        itemId: "",
        qty: 0,
        unitPriceGold: 0,
        totalPriceGold: 0,
        status: "sold",
        createdAt: new Date().toISOString(),
      },
      action: "claim",
      actorCharId: (char as any).id,
      actorCharName: (char as any).name,
      details: { totalGold: total },
    });

    return `You claim ${total} gold from completed auctions.`;
  }

  // ah cancel <listingId>
  if (sub === "cancel") {
    const idStr = parts[2];
    if (!idStr) return "Usage: ah cancel <listingId>";
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return "Invalid listing id.";

    const listing = await ctx.auctions.get(id);
    if (!listing) return "No such auction.";
    if (listing.sellerCharId !== (char as any).id) {
      return "You can only cancel your own auctions.";
    }
    if (listing.status !== "active") {
      return "Only active auctions can be cancelled.";
    }

    const def = ctx.items.get(listing.itemId);
    if (!def) return "Auction refers to an unknown item.";

    const cancelled = await ctx.auctions.cancelListing({
      id: listing.id,
      sellerCharId: (char as any).id,
    });
    if (!cancelled) {
      return "That auction was just bought or already cancelled.";
    }

    // Return items: bags first, overflow via mail
    const giveResult = giveItemsToCharacter(char, [
      { itemId: def.id, quantity: listing.qty },
    ]);

    const applied = giveResult.applied.find((s) => s.itemId === def.id);
    const added = applied?.quantity ?? 0;
    const leftover = listing.qty - added;

    let totalToMail = 0;

    if (leftover > 0 && ctx.mail && ctx.session.identity) {
      await ctx.mail.sendSystemMail(
        ctx.session.identity.userId,
        "account",
        "Auction cancel overflow",
        `Some items from your cancelled auction #${listing.id} could not fit in your bags and were sent by mail.`,
        [{ itemId: def.id, qty: leftover }]
      );
      totalToMail = leftover;
    }

    if (added === 0 && totalToMail === 0) {
      return "Your bags are full and no mail delivery was possible; cannot return items from cancelled auction.";
    }

    await ctx.characters.saveCharacter(char);

    await logAuctionEvent({
      shardId,
      listing: cancelled,
      action: "cancel",
      actorCharId: (char as any).id,
      actorCharName: (char as any).name,
      details: { returnedQty: added, mailedQty: totalToMail },
    });

    let msg = `Cancelled auction #${listing.id}.`;
    if (added > 0) msg += ` Returned ${added}x ${def.name} to your bags.`;
    if (totalToMail > 0) msg += ` ${totalToMail}x sent to your mailbox.`;
    return msg;
  }

  // ah expire (staff-only)
  if (sub === "expire") {
    const identity = ctx.session.identity;
    const flags = identity?.flags;
    const isStaff = !!(flags?.isOwner || flags?.isDev || flags?.isGM);
    if (!isStaff) return "You are not allowed to run auction expiry.";

    const now = new Date();
    const count = await ctx.auctions.expireOld(shardId, now);
    return `Expired ${count} old auctions for shard ${shardId}.`;
  }

  // ah reclaim
  if (sub === "reclaim") {
    const sellerCharId = (char as any).id;

    const listings = await ctx.auctions.reclaimExpiredForSeller({
      shardId,
      sellerCharId,
    });
    if (listings.length === 0) {
      return "You have no expired auctions to reclaim.";
    }

    let totalListings = 0;
    let totalToBags = 0;
    let totalToMail = 0;

    for (const listing of listings) {
      const def = ctx.items.get(listing.itemId);
      if (!def) {
        await logAuctionEvent({
          shardId,
          listing,
          action: "reclaim",
          actorCharId: sellerCharId,
          actorCharName: (char as any).name,
          details: { error: "unknown_item" },
        });
        continue;
      }

      const giveResult = giveItemsToCharacter(char, [
        { itemId: def.id, quantity: listing.qty },
      ]);

      const applied = giveResult.applied.find((s) => s.itemId === def.id);
      const added = applied?.quantity ?? 0;
      const leftover = listing.qty - added;

      if (added > 0) totalToBags += added;

      if (leftover > 0 && ctx.mail && ctx.session.identity) {
        await ctx.mail.sendSystemMail(
          ctx.session.identity.userId,
          "account",
          "Auction reclaim overflow",
          `Some items from your expired auction #${listing.id} could not fit in your bags and were sent by mail.`,
          [{ itemId: def.id, qty: leftover }]
        );
        totalToMail += leftover;
      }

      await logAuctionEvent({
        shardId,
        listing,
        action: "reclaim",
        actorCharId: sellerCharId,
        actorCharName: (char as any).name,
        details: { qty: listing.qty, toBags: added, toMail: leftover },
      });

      totalListings++;
    }

    if (totalToBags > 0) {
      await ctx.characters.saveCharacter(char);
    }

    if (totalListings === 0) {
      return "There were expired auctions, but none could be reclaimed (unknown items).";
    }

    let msg = `Reclaimed items from ${totalListings} expired auction(s).`;
    if (totalToBags > 0) msg += ` ${totalToBags} item(s) went to your bags.`;
    if (totalToMail > 0) msg += ` ${totalToMail} item(s) were sent to your mailbox.`;
    return msg;
  }

  return "Usage: ah browse [search] | ah sell <bag> <slot> <qty> <priceEach> | ah buy <id> | ah my | ah claim";
}
