// worldcore/bank/BankEconomyHelpers.ts

import type { BankState } from "./BankService";

/**
 * Get the current gold balance stored in a bank.
 * If missing, treat as 0.
 */
export function getBankGold(bank: BankState): number {
  return Math.max(0, Math.floor(bank.gold ?? 0));
}

/**
 * Set the gold balance for a bank (clamped to >= 0).
 */
export function setBankGold(bank: BankState, value: number): void {
  bank.gold = Math.max(0, Math.floor(value));
}

/**
 * Add (or subtract) gold from a bank balance.
 */
export function addBankGold(bank: BankState, delta: number): void {
  setBankGold(bank, getBankGold(bank) + delta);
}
