// worldcore/bank/PostgresBankService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import type { ItemStack } from "../characters/CharacterTypes";
import type { BankService, BankState } from "./BankService";
import type { BankOwnerKind } from "./BankTypes";

const log = Logger.scope("BANK");

// For v1, a fixed-size bank. You can bump this later.
export const BANK_SLOT_COUNT = 48;

interface BankSlotRow {
  owner_id: string;
  owner_kind: string;
  slot_index: number;
  item_id: string;
  qty: number;
  meta: any | null;
}

interface BankAccountRow {
  gold: number;
}

export class PostgresBankService implements BankService {
  async getBank(
    ownerId: string,
    ownerKind: BankOwnerKind = "character"
  ): Promise<BankState> {
    const slotRes = await db.query<BankSlotRow>(
      `
      SELECT owner_id, owner_kind, slot_index, item_id, qty, meta
      FROM bank_slots
      WHERE owner_id = $1 AND owner_kind = $2
      ORDER BY slot_index ASC
      `,
      [ownerId, ownerKind]
    );

    const slots: Array<ItemStack | null> = Array(BANK_SLOT_COUNT).fill(null);

    for (const row of slotRes.rows) {
      if (row.slot_index < 0 || row.slot_index >= BANK_SLOT_COUNT) {
        log.warn("Ignoring out-of-range bank slot", {
          ownerId,
          ownerKind,
          slotIndex: row.slot_index,
        });
        continue;
      }
      slots[row.slot_index] = {
        itemId: row.item_id,
        qty: row.qty,
        meta: row.meta ?? undefined,
      };
    }

    // Load gold balance (if any) from bank_accounts
    const goldRes = await db.query<BankAccountRow>(
      `
      SELECT gold
      FROM bank_accounts
      WHERE owner_id = $1 AND owner_kind = $2
      `,
      [ownerId, ownerKind]
    );
    
    const rows = goldRes?.rows ?? [];
    const gold = rows.length > 0 ? Number(rows[0].gold) : 0;
    
    return { ownerId, ownerKind, slots, gold };
  }

  async saveBank(state: BankState): Promise<void> {
    const { ownerId, ownerKind, slots } = state;
    const gold = Math.max(0, Math.floor(state.gold ?? 0));

    try {
      await db.query("BEGIN");

      // Upsert the bank gold balance
      await db.query(
        `
        INSERT INTO bank_accounts (owner_id, owner_kind, gold)
        VALUES ($1, $2, $3)
        ON CONFLICT (owner_id, owner_kind)
        DO UPDATE SET gold = EXCLUDED.gold
        `,
        [ownerId, ownerKind, gold]
      );

      // Replace slot rows for this owner
      await db.query(
        `DELETE FROM bank_slots WHERE owner_id = $1 AND owner_kind = $2`,
        [ownerId, ownerKind]
      );

      for (let idx = 0; idx < slots.length; idx++) {
        const slot = slots[idx];
        if (!slot || slot.qty <= 0) continue;

        await db.query(
          `
          INSERT INTO bank_slots (
            owner_id,
            owner_kind,
            slot_index,
            item_id,
            qty,
            meta
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            ownerId,
            ownerKind,
            idx,
            slot.itemId,
            slot.qty,
            slot.meta ?? null,
          ]
        );
      }

      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      log.warn("Failed to save bank state", {
        ownerId,
        ownerKind,
        err: String(err),
      });
      throw err;
    }
  }
}
