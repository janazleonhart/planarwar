// worldcore/trade/InMemoryTradeService.ts

import { CharacterId } from "../shared/AuthTypes";
import { TradeService } from "./TradeService";
import { TradeItemOffer, TradeSession, TradeSide } from "./TradeTypes";

let TRADE_COUNTER = 0;

function nextTradeId(): string {
  TRADE_COUNTER += 1;
  return `trade_${TRADE_COUNTER}`;
}

export class InMemoryTradeService implements TradeService {
  private sessions = new Map<string, TradeSession>();
  private byChar = new Map<CharacterId, string>(); // charId -> sessionId

  private getSide(session: TradeSession, charId: CharacterId): TradeSide | null {
    if (session.a.characterId === charId) return session.a;
    if (session.b.characterId === charId) return session.b;
    return null;
  }

  createSession(
    aId: CharacterId,
    aName: string,
    bId: CharacterId,
    bName: string
  ): TradeSession {
    // Cancel any existing trades involving either side
    this.cancelFor(aId);
    this.cancelFor(bId);

    const session: TradeSession = {
      id: nextTradeId(),
      a: {
        characterId: aId,
        displayName: aName,
        gold: 0,
        items: [],
        accepted: false,
      },
      b: {
        characterId: bId,
        displayName: bName,
        gold: 0,
        items: [],
        accepted: false,
      },
      status: "open",
      createdAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    this.byChar.set(aId, session.id);
    this.byChar.set(bId, session.id);

    return session;
  }

  getSessionFor(characterId: CharacterId): TradeSession | null {
    const id = this.byChar.get(characterId);
    if (!id) return null;
    return this.sessions.get(id) ?? null;
  }

  cancelFor(characterId: CharacterId): TradeSession | null {
    const session = this.getSessionFor(characterId);
    if (!session) return null;

    this.sessions.delete(session.id);
    this.byChar.delete(session.a.characterId);
    this.byChar.delete(session.b.characterId);

    if (session.status !== "completed") {
      session.status = "cancelled";
    }

    return session;
  }

  clearOffers(characterId: CharacterId): TradeSession | null {
    const session = this.getSessionFor(characterId);
    if (!session) return null;

    const side = this.getSide(session, characterId);
    if (!side) return null;

    side.items = [];
    side.gold = 0;
    side.accepted = false;
    if (session.status === "both_confirmed") {
      session.status = "open";
    }

    return session;
  }

  setOfferGold(characterId: CharacterId, gold: number): TradeSession | null {
    const session = this.getSessionFor(characterId);
    if (!session) return null;

    const side = this.getSide(session, characterId);
    if (!side) return null;

    side.gold = Math.max(0, Math.floor(gold));
    side.accepted = false;
    if (session.status === "both_confirmed") {
      session.status = "open";
    }

    return session;
  }

  addOfferItem(
    characterId: CharacterId,
    offer: TradeItemOffer
  ): TradeSession | null {
    const session = this.getSessionFor(characterId);
    if (!session) return null;

    const side = this.getSide(session, characterId);
    if (!side) return null;

    side.items.push({ ...offer });
    side.accepted = false;
    if (session.status === "both_confirmed") {
      session.status = "open";
    }

    return session;
  }

  setAccepted(
    characterId: CharacterId,
    accepted: boolean
  ): TradeSession | null {
    const session = this.getSessionFor(characterId);
    if (!session) return null;

    const side = this.getSide(session, characterId);
    if (!side) return null;

    side.accepted = accepted;

    if (session.a.accepted && session.b.accepted) {
      session.status = "both_confirmed";
    } else if (session.status === "both_confirmed") {
      session.status = "open";
    }

    return session;
  }
}
