// worldcore/test/contract_auctionCancel_denies_when_return_delivery_unavailable.test.ts
// Contract: cancelling an auction must not mark it cancelled when no delivery path exists.

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
    id: "char_auction_cancel_guard_1",
    userId: "user_auction_cancel_guard_1",
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

test("[contract] auction cancel denies before mutation when return delivery is unavailable", async () => {
  const char = makeChar();
  let cancelCalls = 0;

  const ctx: any = {
    session: {},
    auctions: {
      get: async (id: number) => ({
        id,
        shardId: "prime_shard",
        sellerCharId: char.id,
        sellerCharName: char.name,
        itemId: "ore_copper",
        qty: 5,
        totalPriceGold: 25,
        status: "active",
      }),
      cancelListing: async () => {
        cancelCalls += 1;
        return null;
      },
    },
    items: {
      get: () => ({ id: "ore_copper", name: "Copper Ore" }),
      addToInventory: () => ({ leftover: 5 }),
    },
    characters: {
      saveCharacter: async () => {},
    },
  };

  const msg = await handleAuctionCommand(ctx, char, ["cancel", "123"]);
  assert.match(msg, /bags are full.*mailbox delivery is unavailable/i);
  assert.equal(cancelCalls, 0);
});
