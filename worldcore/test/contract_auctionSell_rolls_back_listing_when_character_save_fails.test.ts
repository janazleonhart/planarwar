// worldcore/test/contract_auctionSell_rolls_back_listing_when_character_save_fails.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleAuctionCommand } from "../mud/commands/economy/auctionCommand";

function makeChar() {
  return {
    id: "char_1",
    name: "Seller",
    shardId: "prime_shard",
    inventory: {
      bags: [
        {
          slots: [
            { itemId: "potion_minor_healing", qty: 5 },
            null,
            null,
          ],
        },
      ],
    },
    gold: 0,
  };
}

test("[contract] auction sell rolls back created listing when character save fails", async () => {
  const char = makeChar();

  let createCalls = 0;
  let revertCalls = 0;
  let saveCalls = 0;

  const ctx: any = {
    items: {
      get: (id: string) =>
        id === "potion_minor_healing"
          ? { id, name: "Minor Healing Potion" }
          : null,
    },
    auctions: {
      createListing: async () => {
        createCalls += 1;
        return {
          id: 99,
          shardId: "prime_shard",
          sellerCharId: "char_1",
          sellerCharName: "Seller",
          itemId: "potion_minor_healing",
          qty: 2,
          unitPriceGold: 25,
          totalPriceGold: 50,
          status: "active",
          createdAt: new Date().toISOString(),
        };
      },
      revertFailedCreateListing: async (args: any) => {
        revertCalls += 1;
        assert.equal(args.id, 99);
        assert.equal(args.shardId, "prime_shard");
        assert.equal(args.sellerCharId, "char_1");
        return true;
      },
    },
    characters: {
      saveCharacter: async () => {
        saveCalls += 1;
        throw new Error("disk full");
      },
    },
  };

  await assert.rejects(
    () => handleAuctionCommand(ctx, char, ["ah", "sell", "0", "0", "2", "25"]),
    /disk full/i
  );

  assert.equal(createCalls, 1);
  assert.equal(revertCalls, 1);
  assert.equal(saveCalls, 1);
  assert.deepEqual(char.inventory.bags[0].slots[0], {
    itemId: "potion_minor_healing",
    qty: 5,
  });
});
