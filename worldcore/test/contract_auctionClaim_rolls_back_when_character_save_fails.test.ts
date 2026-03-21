// worldcore/test/contract_auctionClaim_rolls_back_when_character_save_fails.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { handleAuctionCommand } from "../mud/commands/economy/auctionCommand";

test("[contract] auction claim rolls back proceeds when character save fails", async () => {
  const char: any = {
    id: "seller-1",
    name: "Seller",
    shardId: "prime",
    inventory: { bags: [] },
    gold: 10,
  };

  let revertedArgs: any = null;
  let saveCalls = 0;

  const ctx: any = {
    auctions: {
      claimProceeds: async () => ({ listingIds: [101, 102], total: 75 }),
      revertFailedClaimProceeds: async (args: any) => {
        revertedArgs = args;
        return 2;
      },
    },
    items: {},
    characters: {
      saveCharacter: async () => {
        saveCalls += 1;
        throw new Error("save failed");
      },
    },
  };

  await assert.rejects(
    () => handleAuctionCommand(ctx, char, ["claim"]),
    /save failed/i
  );

  assert.equal(saveCalls, 1);
  assert.equal(char.gold, 10, "gold should be restored when save fails");
  assert.deepEqual(revertedArgs, {
    shardId: "prime",
    sellerCharId: "seller-1",
    listingIds: [101, 102],
  });
});
