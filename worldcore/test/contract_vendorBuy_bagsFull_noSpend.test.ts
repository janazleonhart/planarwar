// worldcore/test/contract_vendorBuy_bagsFull_noSpend.test.ts
//
// Contract: bag-full vendor buy must not spend gold and must not emit audit.

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

import type { VendorDefinition } from "../vendors/VendorTypes";

import { setGold, getGold } from "../items/InventoryHelpers";
import { handleVendorCommand } from "../mud/commands/economy/vendorCommand";
import { __getCapturedVendorEvents, __resetCapturedVendorEvents } from "../vendors/VendorAuditLog";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date();
  const base: CharacterState = {
    id: "char_vendor_bagsfull_1",
    userId: "user_test_1",
    shardId: "prime_shard",
    name: "Vendor BagsFull Tester",
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

function makeVendor(): VendorDefinition {
  return {
    id: "vendor_test_1",
    vendorId: "vendor_test_1",
    name: "Test Vendor",
    items: [
      {
        id: 1,
        itemId: "potion_heal_minor",
        basePriceGold: 3,
        priceGold: 3,
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

function fillAllBagSlots(char: any): void {
  const inv = char.inventory;
  for (const bag of inv.bags ?? []) {
    const slots = bag.slots ?? [];
    for (let i = 0; i < slots.length; i++) {
      slots[i] = { itemId: "junk_item", qty: 1, meta: {} };
    }
  }
}

test("[contract] vendor buy: bags full does not spend gold and emits no audit", async () => {
  const prev = process.env.PW_TEST_CAPTURE_VENDOR_AUDIT;
  process.env.PW_TEST_CAPTURE_VENDOR_AUDIT = "1";
  __resetCapturedVendorEvents();

  try {
    const vendor = makeVendor();
    const ctx = makeCtx(vendor);
    const char = makeChar();

    fillAllBagSlots(char);

    setGold(char.inventory, 10);
    const goldBefore = getGold(char.inventory);

    const msg = await handleVendorCommand(ctx, char, ["buy", vendor.id, "1", "1"]);
    assert.match(msg, /bags are full|can't carry/i);

    const goldAfter = getGold(char.inventory);
    assert.equal(goldAfter, goldBefore);

    const evs = __getCapturedVendorEvents();
    assert.equal(evs.length, 0);
  } finally {
    if (prev === undefined) delete process.env.PW_TEST_CAPTURE_VENDOR_AUDIT;
    else process.env.PW_TEST_CAPTURE_VENDOR_AUDIT = prev;
  }
});
