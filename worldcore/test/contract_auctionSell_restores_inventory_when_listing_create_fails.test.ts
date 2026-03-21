// worldcore/test/contract_auctionSell_restores_inventory_when_listing_create_fails.test.ts
// Contract: ah sell must restore the removed stack if listing creation fails.

import assert from "node:assert/strict";
import test from "node:test";

import type { CharacterState } from "../characters/CharacterTypes";
import {
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";
import { handleAuctionCommand } from "../mud/commands/economy/auctionCommand";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date();
  const base: CharacterState = {
    id: "char_auction_sell_restore_1",
    userId: "user_auction_sell_restore_1",
    shardId: "prime_shard",
    name: "Auction Seller",
    classId: "warrior",
    raceId: "human",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
    progression: defaultProgression(),
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
    guildId: null,
  };
  return { ...base, ...overrides };
}

test("[contract] auction sell restores inventory when listing creation fails", async () => {
  const char = makeChar();
  char.inventory.bags[0].slots[0] = {
    itemId: "potion_heal_minor",
    qty: 5,
  };

  let saveCalls = 0;

  const ctx: any = {
    auctions: {
      createListing: async () => {
        throw new Error("db down");
      },
    },
    items: {
      get: (itemId: string) => ({ id: itemId, name: "Minor Healing Potion" }),
    },
    characters: {
      saveCharacter: async () => {
        saveCalls += 1;
      },
    },
  };

  await assert.rejects(
    () => handleAuctionCommand(ctx, char, ["sell", "0", "0", "2", "25"]),
    /db down/i
  );

  assert.deepEqual(char.inventory.bags[0].slots[0], {
    itemId: "potion_heal_minor",
    qty: 5,
  });
  assert.equal(saveCalls, 0);
});
