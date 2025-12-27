// worldcore/trade/TradeTypes.ts

import { CharacterId } from "../shared/AuthTypes";

export type TradeStatus = "open" | "both_confirmed" | "completed" | "cancelled";

export interface TradeItemOffer {
  bagIndex: number;
  slotIndex: number;
  qty: number;
  itemId: string;
}

export interface TradeSide {
  characterId: CharacterId;
  displayName: string;
  gold: number;
  items: TradeItemOffer[];
  accepted: boolean;
}

export interface TradeSession {
  id: string;
  a: TradeSide;
  b: TradeSide;
  status: TradeStatus;
  createdAt: number;
}
