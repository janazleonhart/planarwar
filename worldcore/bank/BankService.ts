// worldcore/bank/BankService.ts

import type { ItemStack } from "../characters/CharacterTypes";
import type { BankOwnerKind } from "./BankTypes";

export interface BankState {
  ownerId: string;
  ownerKind: BankOwnerKind;
  slots: Array<ItemStack | null>;

  // v2: optional gold balance so we can support personal + guild banks
  gold?: number;
}

export interface BankService {
  /** Load or create an empty bank for this owner. */
  getBank(ownerId: string, ownerKind?: BankOwnerKind): Promise<BankState>;

  /** Persist the entire bank state for this owner. */
  saveBank(state: BankState): Promise<void>;
}
