// worldcore/test/contract_vendorSell_notEnough_noMutation.test.ts
//
// Contract: selling without enough quantity must not mutate inventory/gold and must not emit audit.

import assert from "node:assert/strict";
import test from "node:test";

import type { CharacterState, InventoryState } from "../characters/CharacterTypes";
import {
  defaultAbilities,
  defaultAttributes,
  defaultEquipment,
  defaultInventory,
  defaultProgression,
  defaultSpellbook,
} from "../characters/CharacterTypes";

import type { VendorDefinition } from "../vendors/VendorTypes";

import { setGold, getGold } from "../items/InventoryHelpers";
import { giveItemsToCharacter } from "../economy/EconomyHelpers";
import { handleVendorCommand } from "../mud/commands/economy/vendorCommand";
import { __getCapturedVendorEvents, __resetCapturedVendorEvents } from "../vendors/VendorAuditLog";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date();
  const base: CharacterState = {
    id: "char_vendor_sellnotenough_1",
    userId: "user_test_1",
    shardId: "prime_shard",
    name: "Vendor SellNotEnough Tester",
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

function countItem(inv: InventoryState, itemId: string): number {
  let total = 0;
  for (const bag of inv.bags ?? []) {
    for (const slot of bag.slots ?? []) {
      if (slot?.itemId === itemId) total += Number((slot as any).qty ?? 0);
    }
  }
  return total;
}

function makeVendor(): VendorDefinition {
  return {
    id: "vendor_test_1",
    vendorId: "vendor_test_1",
    name: "Test Vendor",
    items: [
      {
        id: 1,
        itemId: "rat_tail",
        basePriceGold: 2,
        priceGold: 2,
        stock: null,
        stockMax: null,
        econ: null,
      },
    ],
  };
}

function makeCtx(vendor: VendorDefinition): any {
  return {
    session: { id: "sess_test_1", roomId: "room_test_1", auth: { isAdmin: true } },
    vendors: {
      getVendor: async (id: string) => (id === vendor.id ? vendor : null),
      listVendors: async () => [{ id: vendor.id, name: vendor.name }],
    },
    items: {},
    characters: {
      saveCharacter: async () => {},
    },
  };
}

test("[contract] vendor sell: not enough quantity does not mutate and emits no audit", async () => {
  const prev = process.env.PW_TEST_CAPTURE_VENDOR_AUDIT;
  process.env.PW_TEST_CAPTURE_VENDOR_AUDIT = "1";
  __resetCapturedVendorEvents();

  try {
    const vendor = makeVendor();
    const ctx = makeCtx(vendor);
    const char = makeChar();

    setGold(char.inventory, 5);
    giveItemsToCharacter(char, [{ itemId: "rat_tail", quantity: 1 }]);

    const goldBefore = getGold(char.inventory);
    const itemBefore = countItem(char.inventory, "rat_tail");

    const msg = await handleVendorCommand(ctx, char, ["sell", vendor.id, "rat_tail", "2"]);
    assert.match(msg, /do not have enough|not enough/i);

    assert.equal(getGold(char.inventory), goldBefore);
    assert.equal(countItem(char.inventory, "rat_tail"), itemBefore);

    const evs = __getCapturedVendorEvents();
    assert.equal(evs.length, 0);
  } finally {
    if (prev === undefined) delete process.env.PW_TEST_CAPTURE_VENDOR_AUDIT;
    else process.env.PW_TEST_CAPTURE_VENDOR_AUDIT = prev;
  }
});
