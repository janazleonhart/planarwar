// worldcore/test/contract_auctionBuyout_mailbox_save_before_delivery.test.ts
// Contract: mailbox buyout must persist buyer gold before delivery and roll back before mailing on save failure.

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
import { setGold, getGold } from "../items/InventoryHelpers";
import { handleAuctionCommand } from "../mud/commands/economy/auctionCommand";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date();
  const base: CharacterState = {
    id: "char_auction_buyout_mailbox_save_1",
    userId: "user_auction_buyout_mailbox_save_1",
    shardId: "prime_shard",
    name: "Auction Tester",
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

test("[contract] auction mailbox buyout saves buyer before delivery and rolls back on save failure", async () => {
  const char = makeChar();
  setGold(char.inventory, 250);
  const goldBefore = getGold(char.inventory);

  let revertCalls = 0;
  let saveCalls = 0;
  let mailCalls = 0;

  const ctx: any = {
    session: { identity: { userId: char.userId } },
    auctions: {
      get: async (id: number) => ({
        id,
        shardId: "prime_shard",
        sellerCharId: "seller_1",
        sellerCharName: "Seller",
        itemId: "potion_heal_minor",
        qty: 2,
        totalPriceGold: 50,
        status: "active",
      }),
      buyout: async (args: any) => ({
        id: args.id,
        shardId: args.shardId,
        sellerCharId: "seller_1",
        sellerCharName: "Seller",
        itemId: "potion_heal_minor",
        qty: 2,
        totalPriceGold: 50,
        status: "sold",
        buyerCharId: char.id,
        buyerCharName: char.name,
        proceedsGold: 50,
        proceedsClaimed: false,
        createdAt: new Date().toISOString(),
      }),
      revertFailedBuyout: async () => {
        revertCalls += 1;
        return null;
      },
    },
    mail: {
      sendSystemMail: async () => {
        mailCalls += 1;
      },
    },
    items: {
      get: () => ({ id: "potion_heal_minor", name: "Minor Healing Potion" }),
      addToInventory: () => ({ leftover: 0 }),
    },
    characters: {
      saveCharacter: async () => {
        saveCalls += 1;
        throw new Error("save down");
      },
    },
  };

  await assert.rejects(() => handleAuctionCommand(ctx, char, ["buy", "123"]), /save down/i);
  assert.equal(getGold(char.inventory), goldBefore);
  assert.equal(revertCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(mailCalls, 0);
});
