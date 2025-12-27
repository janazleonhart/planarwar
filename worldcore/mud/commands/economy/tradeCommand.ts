//worldcore/mud/commands/tradeCommand.ts

import { formatTradeSessionView, finalizeTrade } from "../../../trade/tradeOps";
import { getCharacterGold } from "../../../economy/EconomyHelpers";
import { findSessionByCharacterId, findSessionByCharacterNameInRoom } from "../sessionLookup";

export async function handleTradeCommand(ctx: any, char: any, args: string[]): Promise<string> {
  if (!ctx.trades) return "Trading service is not available.";

  const sub = (args[0] ?? "").toLowerCase();

  // trade
  if (!sub || sub === "show" || sub === "status") {
    const s = ctx.trades.getSessionFor(char.id);
    if (!s) return "You are not currently trading.";
    return formatTradeSessionView(char.id, s);
  }

  // trade with <name>
  if (sub === "with" || sub === "start") {
    const targetName = args[1];
    if (!targetName) return "Usage: trade with <playerName>";

    const roomId = ctx.session.roomId;
    const targetSession = findSessionByCharacterNameInRoom(ctx, roomId, targetName);
    if (!targetSession || !targetSession.character) return `No player named '${targetName}' is here.`;
    if (targetSession.id === ctx.session.id) return "You can't trade with yourself.";

    const existing = ctx.trades.getSessionFor(char.id);
    if (existing) return "You are already in a trade. Use 'trade cancel' first.";

    const tChar = targetSession.character;

    ctx.trades.createSession(char.id, char.name, tChar.id, tChar.name);

    ctx.sessions.send(targetSession, "mud_result", {
      text: `[trade] ${char.name} has started a trade with you. Use 'trade' to view, 'trade additem', 'trade addgold', and 'trade confirm' when ready.`,
    });

    return `Started trade with ${tChar.name}. Use 'trade' to view it.`;
  }

  // trade cancel
  if (sub === "cancel") {
    const s = ctx.trades.getSessionFor(char.id);
    if (!s) return "You are not currently trading.";

    ctx.trades.cancelFor(char.id);

    const otherId = s.a.characterId === char.id ? s.b.characterId : s.a.characterId;
    const otherSession = findSessionByCharacterId(ctx, otherId);
    if (otherSession) {
      ctx.sessions.send(otherSession, "mud_result", {
        text: `[trade] Trade with ${char.name} has been cancelled.`,
      });
    }

    return "Trade cancelled.";
  }

  // trade clear
  if (sub === "clear") {
    const s = ctx.trades.getSessionFor(char.id);
    if (!s) return "You are not currently trading.";
    ctx.trades.clearOffers(char.id);
    return "Your trade offer has been cleared.";
  }

  // trade addgold <amount>
  if (sub === "addgold") {
    const amount = Number(args[1] ?? "0") || 0;
    if (amount < 0) return "Amount must be non-negative.";

    const s = ctx.trades.getSessionFor(char.id);
    if (!s) return "You are not currently trading.";

    const currentGold = getCharacterGold(char);
    if (currentGold < amount) {
      return `You don't have that much gold. (You have ${currentGold}.)`;
    }

    ctx.trades.setOfferGold(char.id, amount);
    return `You offer ${amount} gold in the trade.`;
  }

  // trade additem <bag> <slot> [qty]
  if (sub === "additem") {
    const bagIndex = Number(args[1] ?? "-1");
    const slotIndex = Number(args[2] ?? "-1");
    const qty = Number(args[3] ?? "0") || 0;

    if (!Number.isInteger(bagIndex) || !Number.isInteger(slotIndex) || bagIndex < 0 || slotIndex < 0) {
      return "Usage: trade additem <bagIndex> <slotIndex> [qty]";
    }

    const s = ctx.trades.getSessionFor(char.id);
    if (!s) return "You are not currently trading.";

    const bag = char.inventory.bags[bagIndex];
    if (!bag) return "Invalid bag index.";
    const slot = bag.slots[slotIndex];
    if (!slot) return "That slot is empty.";

    const maxQty = slot.qty;
    const useQty = qty > 0 ? qty : maxQty;
    if (useQty <= 0 || useQty > maxQty) return `Invalid quantity; you have ${maxQty} in that slot.`;

    ctx.trades.addOfferItem(char.id, {
      bagIndex,
      slotIndex,
      qty: useQty,
      itemId: slot.itemId,
    });

    return `You offer ${useQty}x ${slot.itemId} from bag ${bagIndex}, slot ${slotIndex}.`;
  }

  // trade confirm
  if (sub === "confirm") {
    const s = ctx.trades.getSessionFor(char.id);
    if (!s) return "You are not currently trading.";

    ctx.trades.setAccepted(char.id, true);

    const view = formatTradeSessionView(char.id, s);

    const otherId = s.a.characterId === char.id ? s.b.characterId : s.a.characterId;
    const otherSession = findSessionByCharacterId(ctx, otherId);

    if (s.status === "both_confirmed") {
      const result = await finalizeTrade(ctx, s, char.id, ctx.session, otherSession);
      return `${view}\n\n${result}`;
    }

    if (otherSession) {
      ctx.sessions.send(otherSession, "mud_result", {
        text: `[trade] ${char.name} has accepted the trade. Use 'trade confirm' when ready.`,
      });
    }

    return `${view}\n\nYou have accepted the trade. Waiting for the other player.`;
  }

  return "Usage: trade [with <name> | additem <bag> <slot> [qty] | addgold <amount> | clear | confirm | cancel | show]";
}
