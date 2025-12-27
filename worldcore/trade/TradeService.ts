// worldcore/trade/TradeService.ts

import { CharacterId } from "../shared/AuthTypes";
import { TradeItemOffer, TradeSession } from "./TradeTypes";

export interface TradeService {
  /**
   * Create/replace a trade session between A and B.
   * Cancels any existing session for either side.
   */
  createSession(
    aId: CharacterId,
    aName: string,
    bId: CharacterId,
    bName: string
  ): TradeSession;

  /** Find the active trade session for this character, if any. */
  getSessionFor(characterId: CharacterId): TradeSession | null;

  /** Cancel the session this character is part of (if any). */
  cancelFor(characterId: CharacterId): TradeSession | null;

  /** Clear this character's offer (gold + items). */
  clearOffers(characterId: CharacterId): TradeSession | null;

  /** Set the gold this character is offering. */
  setOfferGold(characterId: CharacterId, gold: number): TradeSession | null;

  /** Add an item offer (bag/slot/qty) for this character. */
  addOfferItem(
    characterId: CharacterId,
    offer: TradeItemOffer
  ): TradeSession | null;

  /**
   * Mark this character as (not) accepted. If both accept,
   * the session status becomes "both_confirmed".
   */
  setAccepted(
    characterId: CharacterId,
    accepted: boolean
  ): TradeSession | null;
}
