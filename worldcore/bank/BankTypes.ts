// worldcore/bank/BankTypes.ts

export type BankOwnerKind = "account" | "character" | "guild" | "city";

export interface BankOwnerRef {
  ownerId: string;
  ownerKind: BankOwnerKind;
}
