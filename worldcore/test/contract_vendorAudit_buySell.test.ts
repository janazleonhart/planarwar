// worldcore/test/contract_vendorAudit_buySell.test.ts
//
// Contract: successful vendor buy/sell emits audit events (test-capture mode),
// and deny paths do NOT emit audit.

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
import { giveItemsToCharacter } from "../economy/EconomyHelpers";
import { handleVendorCommand } from "../mud/commands/economy/vendorCommand";
import { __getCapturedVendorEvents, __resetCapturedVendorEvents } from "../vendors/VendorAuditLog";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date();
  const base: CharacterState = {
    id: "char_vendor_audit_1",
    userId: "user_test_1",
    shardId: "prime_shard",
    name: "Vendor Audit Tester",
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
      {
        id: 2,
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

test("[contract] vendor audit: buy + sell emits events; deny does not", async () => {
  const prev = process.env.PW_TEST_CAPTURE_VENDOR_AUDIT;
  process.env.PW_TEST_CAPTURE_VENDOR_AUDIT = "1";
  __resetCapturedVendorEvents();

  try {
    const vendor = makeVendor();
    const ctx = makeCtx(vendor);
    const char = makeChar();

    // Buy success
    setGold(char.inventory, 10);
    const buyMsg = await handleVendorCommand(ctx, char, ["buy", vendor.id, "1", "2"]);
    assert.match(buyMsg, /buy/i);

    // Sell success (ensure we have the item)
    const sellMsg = await handleVendorCommand(ctx, char, ["sell", vendor.id, "potion_heal_minor", "1"]);
    assert.match(sellMsg, /sell/i);

    const evs = __getCapturedVendorEvents();
    assert.equal(evs.length, 2);

    assert.equal(evs[0].action, "buy");
    assert.equal(evs[0].result, "ok");
    assert.equal(evs[0].vendorId, vendor.id);

    assert.ok(evs[0].meta, "Expected meta on buy audit event");
    assert.equal((evs[0].meta as any)?.schemaVersion, 1);
    assert.equal((evs[0].meta as any)?.rule, "vendor.buy.ok");

    assert.equal(evs[1].action, "sell");
    assert.equal(evs[1].result, "ok");
    assert.equal(evs[1].vendorId, vendor.id);

    assert.ok(evs[1].meta, "Expected meta on sell audit event");
    assert.equal((evs[1].meta as any)?.schemaVersion, 1);
    assert.equal((evs[1].meta as any)?.rule, "vendor.sell.ok");

    // Deny path: can't afford should emit NO new audit
    __resetCapturedVendorEvents();
    setGold(char.inventory, 0);
    const denyMsg = await handleVendorCommand(ctx, char, ["buy", vendor.id, "1", "1"]);
    assert.match(denyMsg, /cannot afford|cost/i);

    const evs2 = __getCapturedVendorEvents();
    assert.equal(evs2.length, 0);
  } finally {
    if (prev === undefined) delete process.env.PW_TEST_CAPTURE_VENDOR_AUDIT;
    else process.env.PW_TEST_CAPTURE_VENDOR_AUDIT = prev;
  }
});
