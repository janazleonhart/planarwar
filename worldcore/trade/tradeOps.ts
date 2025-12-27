// worldcore/trade/tradeOps.ts

import type { InventoryState, ItemStack } from "../characters/CharacterTypes";
import type { TradeSession } from "./TradeTypes";
import { logCompletedTrade } from "./TradeAuditLog";
import { findFreeBagSlot } from "../items/InventoryHelpers";
import {
  getCharacterGold,
  setCharacterGold,
} from "../economy/EconomyHelpers";

// Keep this tiny and structural: trade ops should not depend on the command parser.
// We only need the bits finalizeTrade touches.
export type TradeFinalizeContext = {
  sessions: { send(session: any, op: string, payload: { text: string }): void };
  characters?: {
    getById(id: string): Promise<any>;
    saveCharacter(char: any): Promise<void>;
  };
  trades?: { cancelFor(charId: string): void };
};

export function formatTradeSessionView(myCharId: string, session: TradeSession): string {
  const me = session.a.characterId === myCharId ? session.a : session.b;
  const them = session.a.characterId === myCharId ? session.b : session.a;

  const meLines: string[] = [];
  meLines.push(`You offer: ${me.gold} gold`);
  if (me.items.length === 0) {
    meLines.push("  (no items)");
  } else {
    for (const it of me.items) {
      meLines.push(`  bag ${it.bagIndex}, slot ${it.slotIndex}, qty ${it.qty}`);
    }
  }

  const themLines: string[] = [];
  themLines.push(`${them.displayName} offers: ${them.gold} gold`);
  if (them.items.length === 0) {
    themLines.push("  (no items)");
  } else {
    for (const it of them.items) {
      themLines.push(`  bag ${it.bagIndex}, slot ${it.slotIndex}, qty ${it.qty}`);
    }
  }

  const status =
    session.status === "both_confirmed"
      ? "BOTH CONFIRMED (ready to finalize)"
      : `You: ${me.accepted ? "accepted" : "not accepted"}, ` +
        `${them.displayName}: ${them.accepted ? "accepted" : "not accepted"}`;

  return [
    `Trade with ${them.displayName} [${session.id}]`,
    status,
    "",
    ...meLines,
    "",
    ...themLines,
  ].join("\n");
}

/** Ensure the inventory actually contains the offered item stack. */
function validateOfferItem(
  inv: InventoryState,
  itemId: string,
  bagIndex: number,
  slotIndex: number,
  qty: number
): boolean {
  const bag = inv.bags[bagIndex];
  if (!bag) return false;
  const slot = bag.slots[slotIndex];
  if (!slot) return false;
  if (slot.itemId !== itemId) return false;
  if (slot.qty < qty) return false;
  return true;
}

/**
 * Move an offered item from one inventory to another.
 * Returns true on success, false if dest had no free slot.
 */
function transferOfferedItem(
  fromInv: InventoryState,
  toInv: InventoryState,
  bagIndex: number,
  slotIndex: number,
  qty: number
): boolean {
  const bag = fromInv.bags[bagIndex];
  if (!bag) return false;
  const slot = bag.slots[slotIndex];
  if (!slot) return false;

  const itemId = slot.itemId;
  const meta = slot.meta;

  // 1) Try stacking
  for (let b = 0; b < toInv.bags.length; b++) {
    const destBag = toInv.bags[b];
    for (let s = 0; s < destBag.slots.length; s++) {
      const destSlot = destBag.slots[s];
      if (!destSlot) continue;
      if (destSlot.itemId !== itemId) continue;

      // ignoring maxStack for v1 (as in your current logic)
      destSlot.qty += qty;

      // remove from source
      if (qty === slot.qty) bag.slots[slotIndex] = null;
      else slot.qty -= qty;

      return true;
    }
  }

  // 2) Free slot
  const free = findFreeBagSlot(toInv);
  if (!free) return false;

  const moving = { itemId, qty, meta } as ItemStack;

  if (qty === slot.qty) bag.slots[slotIndex] = null;
  else slot.qty -= qty;

  const destBag = toInv.bags[free.bagIndex];
  destBag.slots[free.slotIndex] = moving;

  return true;
}

/**
 * Finalize a trade once both sides have set accepted=true.
 * Returns a human-readable result string for the caller.
 */
export async function finalizeTrade(
  ctx: TradeFinalizeContext,
  session: TradeSession,
  callerCharId: string,
  aSession: any,
  bSession: any
): Promise<string> {
  if (!ctx.characters) return "Character service unavailable; cannot finalize trade.";

  // Re-load characters (authoritative)
  const charA = await ctx.characters.getById(session.a.characterId);
  const charB = await ctx.characters.getById(session.b.characterId);
  if (!charA || !charB) return "Trade failed: one of the characters no longer exists.";

  // Verify items still exist
  for (const it of session.a.items) {
    if (!validateOfferItem(charA.inventory, it.itemId, it.bagIndex, it.slotIndex, it.qty)) {
      ctx.trades?.cancelFor(callerCharId);
      return `Trade aborted: ${session.a.displayName} no longer has the offered items.`;
    }
  }
  for (const it of session.b.items) {
    if (!validateOfferItem(charB.inventory, it.itemId, it.bagIndex, it.slotIndex, it.qty)) {
      ctx.trades?.cancelFor(callerCharId);
      return `Trade aborted: ${session.b.displayName} no longer has the offered items.`;
    }
  }

  // Verify gold
  const goldA = getCharacterGold(charA);
  const goldB = getCharacterGold(charB);
  if (goldA < session.a.gold) {
    ctx.trades?.cancelFor(callerCharId);
    return `Trade aborted: ${session.a.displayName} no longer has enough gold.`;
  }
  if (goldB < session.b.gold) {
    ctx.trades?.cancelFor(callerCharId);
    return `Trade aborted: ${session.b.displayName} no longer has enough gold.`;
  }

  // Transfer gold
  const aGoldAfter = goldA - session.a.gold + session.b.gold;
  const bGoldAfter = goldB - session.b.gold + session.a.gold;
  setCharacterGold(charA, aGoldAfter);
  setCharacterGold(charB, bGoldAfter);

  // Transfer items (abort if any transfer fails)
  for (const offer of session.a.items) {
    if (!transferOfferedItem(charA.inventory, charB.inventory, offer.bagIndex, offer.slotIndex, offer.qty)) {
      ctx.trades?.cancelFor(callerCharId);
      return "Trade aborted: not enough bag space for one of the offers.";
    }
  }
  for (const offer of session.b.items) {
    if (!transferOfferedItem(charB.inventory, charA.inventory, offer.bagIndex, offer.slotIndex, offer.qty)) {
      ctx.trades?.cancelFor(callerCharId);
      return "Trade aborted: not enough bag space for one of the offers.";
    }
  }

  await ctx.characters.saveCharacter(charA);
  await ctx.characters.saveCharacter(charB);

  // Logging must never break a completed trade
  try {
    await logCompletedTrade({
      session,
      aGoldBefore: goldA,
      aGoldAfter,
      bGoldBefore: goldB,
      bGoldAfter,
      aItemsGiven: session.a.items,
      aItemsReceived: session.b.items,
      bItemsGiven: session.b.items,
      bItemsReceived: session.a.items,
    });
  } catch {}

  // Notify both sides
  ctx.sessions.send(aSession, "mud_result", {
    text: `[trade] Trade completed with ${session.b.displayName}.`,
  });
  ctx.sessions.send(bSession, "mud_result", {
    text: `[trade] Trade completed with ${session.a.displayName}.`,
  });

  ctx.trades?.cancelFor(callerCharId);
  session.status = "completed";

  return "Trade completed.";
}
