// worldcore/mud/commands/economy/auctionCommand.ts

import {
  getCharacterGold,
  setCharacterGold,
  giveGold,
} from "../../../economy/EconomyHelpers";
import { deliverItemToBagsOrMail } from "../../../loot/OverflowDelivery";
import { logAuctionEvent } from "../../../auction/AuctionAuditLog";
import { formatAuctionListing } from "../../../auction/AuctionFormat";

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function canFitItemInBags(
  ctx: any,
  char: any,
  itemId: string,
  qty: number
): boolean {
  try {
    const previewInv = deepClone(char.inventory);
    const preview = ctx.items.addToInventory(previewInv, itemId, qty);
    return (preview?.leftover ?? 0) <= 0;
  } catch {
    return false;
  }
}

export async function handleAuctionCommand(
  ctx: any,
  char: any,
  parts: string[]
): Promise<string> {
  if (!ctx.auctions) return "Auction House service is not available.";
  if (!ctx.items) return "Item service is not available.";
  if (!ctx.characters) return "Character service is not available.";

  const normalizedParts =
    parts.length > 0 && ["auction", "ah"].includes((parts[0] || "").toLowerCase())
      ? parts.slice(1)
      : parts;
  const sub = (normalizedParts[0] || "").toLowerCase();
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

  if (sub === "browse") {
    const search = normalizedParts.slice(1).join(" ").trim() || undefined;
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

  if (sub === "sell") {
    const bagIndex = Number(normalizedParts[1] ?? "-1");
    const slotIndex = Number(normalizedParts[2] ?? "-1");
    const qtyStr = normalizedParts[3];
    const priceStr = normalizedParts[4];

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

    const def = ctx.items.get(slot.itemId);
    if (!def) return "Only DB-backed items can be auctioned.";

    const originalSlot = slot ? { ...slot } : null;

    if (qty === slot.qty) bag.slots[slotIndex] = null;
    else slot.qty -= qty;

    let listing;
    try {
      listing = await ctx.auctions.createListing({
        shardId,
        sellerCharId: (char as any).id,
        sellerCharName: (char as any).name,
        itemId: def.id,
        qty,
        unitPriceGold: priceEach,
      });
    } catch (err) {
      bag.slots[slotIndex] = originalSlot;
      throw err;
    }

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

    try {
      await ctx.characters.saveCharacter(char);
    } catch (err) {
      bag.slots[slotIndex] = originalSlot;
      if (typeof ctx.auctions.revertFailedCreateListing === "function") {
        await ctx.auctions.revertFailedCreateListing({
          id: listing.id,
          shardId,
          sellerCharId: (char as any).id,
        });
      }
      throw err;
    }

    return `Created auction #${listing.id}: ${def.name} x${qty} for ${priceEach}g each (total ${listing.totalPriceGold}g).`;
  }

  if (sub === "buy") {
    const idStr = normalizedParts[1];
    if (!idStr) return "Usage: ah buy <listingId>";
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return "Invalid listing id.";

    const listing = await ctx.auctions.get(id);
    if (!listing || listing.status !== "active" || listing.shardId !== shardId) {
      return "That auction is not available.";
    }
    if (listing.sellerCharId === (char as any).id) {
      return "You cannot buy your own auction.";
    }

    const def = ctx.items.get(listing.itemId);
    if (!def) return "Auction refers to an unknown item.";

    const price = listing.totalPriceGold;
    const currentGold = getCharacterGold(char);
    if (currentGold < price) {
      return `You do not have enough gold. You need ${price}, but have ${currentGold}.`;
    }

    const canMailbox = !!(ctx.mail && ctx.session?.identity?.userId);
    if (!canMailbox) {
      try {
        const previewInv = deepClone(char.inventory);
        const preview = ctx.items.addToInventory(previewInv, def.id, listing.qty);
        if (preview?.leftover > 0) {
          return "Your bags are full and mailbox delivery is unavailable. Clear space and try again.";
        }
      } catch {
        return "Cannot verify inventory space for delivery (mailbox unavailable). Please try again or contact staff.";
      }
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

    const revertFailedBuyout = async () => {
      if (typeof ctx.auctions.revertFailedBuyout === "function") {
        await ctx.auctions.revertFailedBuyout({
          id: updated.id,
          shardId,
          buyerCharId: (char as any).id,
        });
      }
    };

    if (canMailbox) {
      try {
        await ctx.mail.sendSystemMail(
          ctx.session.identity.userId,
          "account",
          "Auction purchase",
          `You bought ${listing.qty}x ${def.name} for ${price} gold from ${listing.sellerCharName}.`,
          [{ itemId: def.id, qty: listing.qty }]
        );

        setCharacterGold(char, currentGold - price);
        await logAuctionEvent({
          shardId,
          listing: updated,
          action: "buy",
          actorCharId: (char as any).id,
          actorCharName: (char as any).name,
          details: { priceGold: price },
        });
        await ctx.characters.saveCharacter(char);
        return `You bought ${listing.qty}x ${def.name} for ${price} gold. The items have been mailed to you.`;
      } catch {
        await revertFailedBuyout();
        return "That auction could not be delivered right now, so the buyout was rolled back. Clear bag space and try again.";
      }
    }

    const res = ctx.items.addToInventory(char.inventory, def.id, listing.qty);
    if (res?.leftover > 0) {
      await revertFailedBuyout();
      return "That auction could not be delivered right now, so the buyout was rolled back. Clear bag space and try again.";
    }

    setCharacterGold(char, currentGold - price);
    await logAuctionEvent({
      shardId,
      listing: updated,
      action: "buy",
      actorCharId: (char as any).id,
      actorCharName: (char as any).name,
      details: { priceGold: price },
    });
    await ctx.characters.saveCharacter(char);

    return `You bought ${listing.qty}x ${def.name} for ${price} gold. The items were delivered to your bags.`;
  }

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

  if (sub === "claim") {
    const claim = await ctx.auctions.claimProceeds({
      shardId,
      sellerCharId: (char as any).id,
    });
    if ((claim?.total ?? 0) <= 0) return "You have no auction proceeds to claim.";

    giveGold(char, claim.total);
    try {
      await ctx.characters.saveCharacter(char);
    } catch (error) {
      setCharacterGold(char, getCharacterGold(char) - claim.total);
      if (typeof ctx.auctions.revertFailedClaimProceeds === "function") {
        await ctx.auctions.revertFailedClaimProceeds({
          shardId,
          sellerCharId: (char as any).id,
          listingIds: claim.listingIds,
        });
      }
      throw error;
    }

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
      details: { totalGold: claim.total },
    });

    return `You claim ${claim.total} gold from completed auctions.`;
  }

  if (sub === "cancel") {
    const idStr = normalizedParts[1];
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

    const canMailbox = !!(ctx.mail && ctx.session?.identity?.userId);
    if (!canMailbox && !canFitItemInBags(ctx, char, def.id, listing.qty)) {
      return "Your bags are full and mailbox delivery is unavailable; clear space before cancelling this auction.";
    }

    const cancelled = await ctx.auctions.cancelListing({
      id: listing.id,
      shardId,
      sellerCharId: (char as any).id,
    });
    if (!cancelled) {
      return "That auction was just bought or already cancelled.";
    }

    const deliver = await deliverItemToBagsOrMail(ctx, {
      inventory: char.inventory,
      itemId: def.id,
      qty: listing.qty,
      ownerId: ctx.session?.identity?.userId,
      ownerKind: "account",
      sourceVerb: "returning",
      sourceName: `cancelled auction #${listing.id}`,
      mailSubject: "Auction cancel overflow",
      mailBody: `Some items from your cancelled auction #${listing.id} could not fit in your bags and were sent by mail.`,
      undeliveredPolicy: "keep",
    });

    const added = deliver.added;
    const totalToMail = deliver.mailed;

    if (added === 0 && totalToMail === 0) {
      return "Your bags are full and no mail delivery was possible; cannot return items from cancelled auction.";
    }

    if (added > 0) {
      await ctx.characters.saveCharacter(char);
    }

    await logAuctionEvent({
      shardId,
      listing: cancelled,
      action: "cancel",
      actorCharId: (char as any).id,
      actorCharName: (char as any).name,
      details: {
        returnedQty: added,
        mailedQty: totalToMail,
        undeliveredQty: deliver.leftover,
      },
    });

    let msg = `Cancelled auction #${listing.id}.`;
    if (added > 0) msg += ` Returned ${added}x ${def.name} to your bags.`;
    if (totalToMail > 0) msg += ` ${totalToMail}x sent to your mailbox.`;
    if (deliver.leftover > 0) {
      msg += ` (${deliver.leftover}x could not be delivered.)`;
    }
    return msg;
  }

  if (sub === "expire") {
    const identity = ctx.session?.identity;
    const flags = identity?.flags;
    const isStaff = !!(flags?.isOwner || flags?.isDev || flags?.isGM);
    if (!isStaff) return "You are not allowed to run auction expiry.";

    const now = new Date();
    const count = await ctx.auctions.expireOld(shardId, now);
    return `Expired ${count} old auctions for shard ${shardId}.`;
  }

  if (sub === "reclaim") {
    const sellerCharId = (char as any).id;
    const canMailbox = !!(ctx.mail && ctx.session?.identity?.userId);

    const reclaimable = (
      await ctx.auctions.listBySeller({
        shardId,
        sellerCharId,
      })
    ).filter(
      (listing: any) => listing.status === "expired" && !listing.itemsReclaimed
    );

    if (reclaimable.length === 0) {
      return "You have no expired auctions to reclaim.";
    }

    let totalListings = 0;
    let totalToBags = 0;
    let totalToMail = 0;
    let blockedListings = 0;

    for (const listing of reclaimable) {
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

      if (!canMailbox && !canFitItemInBags(ctx, char, def.id, listing.qty)) {
        blockedListings += 1;
        continue;
      }

      const claimed = await ctx.auctions.reclaimExpiredListing({
        id: listing.id,
        shardId,
        sellerCharId,
      });
      if (!claimed) continue;

      const deliver = await deliverItemToBagsOrMail(ctx, {
        inventory: char.inventory,
        itemId: def.id,
        qty: claimed.qty,
        ownerId: ctx.session?.identity?.userId,
        ownerKind: "account",
        sourceVerb: "reclaiming",
        sourceName: `expired auction #${claimed.id}`,
        mailSubject: "Auction reclaim overflow",
        mailBody: `Some items from your expired auction #${claimed.id} could not fit in your bags and were sent by mail.`,
        undeliveredPolicy: "keep",
      });

      const added = deliver.added;
      const mailed = deliver.mailed;
      if (added > 0) totalToBags += added;
      if (mailed > 0) totalToMail += mailed;

      await logAuctionEvent({
        shardId,
        listing: claimed,
        action: "reclaim",
        actorCharId: sellerCharId,
        actorCharName: (char as any).name,
        details: {
          qty: claimed.qty,
          toBags: added,
          toMail: mailed,
          undeliveredQty: deliver.leftover,
        },
      });

      totalListings++;
    }

    if (totalToBags > 0) {
      await ctx.characters.saveCharacter(char);
    }

    if (totalListings === 0) {
      if (blockedListings > 0) {
        return "Your bags are full and mailbox delivery is unavailable; clear space before reclaiming expired auctions.";
      }
      return "There were expired auctions, but none could be reclaimed (unknown items).";
    }

    let msg = `Reclaimed items from ${totalListings} expired auction(s).`;
    if (totalToBags > 0) msg += ` ${totalToBags} item(s) went to your bags.`;
    if (totalToMail > 0) msg += ` ${totalToMail} item(s) were sent to your mailbox.`;
    if (blockedListings > 0) {
      msg += ` ${blockedListings} auction(s) were left untouched because you lacked bag space and mailbox delivery was unavailable.`;
    }
    return msg;
  }

  return "Usage: ah browse [search] | ah sell <bag> <slot> <qty> <priceEach> | ah buy <id> | ah my | ah claim";
}