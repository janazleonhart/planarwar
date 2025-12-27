// worldcore/trade/TradeAuditLog.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import { TradeSession, TradeItemOffer } from "./TradeTypes";

const log = Logger.scope("TRADE_AUDIT");

interface TradeLogItem {
  itemId: string;
  qty: number;
  bagIndex: number;
  slotIndex: number;
}

function offersToLogItems(
  offers: TradeItemOffer[],
): TradeLogItem[] {
  return offers.map(o => ({
    itemId: o.itemId,
    qty: o.qty,
    bagIndex: o.bagIndex,
    slotIndex: o.slotIndex,
  }));
}

export async function logCompletedTrade(opts: {
  session: TradeSession;
  aGoldBefore: number;
  aGoldAfter: number;
  bGoldBefore: number;
  bGoldAfter: number;
  aItemsGiven: TradeItemOffer[];
  aItemsReceived: TradeItemOffer[];
  bItemsGiven: TradeItemOffer[];
  bItemsReceived: TradeItemOffer[];
}): Promise<void> {
  const { session } = opts;

  try {
    await db.query(
      `
      INSERT INTO trade_log (
        a_char_id,
        a_char_name,
        b_char_id,
        b_char_name,
        a_gold_before,
        a_gold_after,
        b_gold_before,
        b_gold_after,
        a_items_given,
        a_items_received,
        b_items_given,
        b_items_received
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9::jsonb, $10::jsonb,
        $11::jsonb, $12::jsonb
      )
      `,
      [
        session.a.characterId,
        session.a.displayName,
        session.b.characterId,
        session.b.displayName,
        opts.aGoldBefore,
        opts.aGoldAfter,
        opts.bGoldBefore,
        opts.bGoldAfter,
        JSON.stringify(offersToLogItems(opts.aItemsGiven)),
        JSON.stringify(offersToLogItems(opts.aItemsReceived)),
        JSON.stringify(offersToLogItems(opts.bItemsGiven)),
        JSON.stringify(offersToLogItems(opts.bItemsReceived)),
      ]
    );
  } catch (err) {
    log.warn("Failed to insert trade_log row", {
      err: String(err),
      sessionId: session.id,
    });
  }
}
