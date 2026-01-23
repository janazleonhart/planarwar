// worldcore/test/behavior_economyV0_vendorGold.test.ts

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

import { getGold, setGold } from "../items/InventoryHelpers";
import { buyFromVendor, sellToVendor } from "../vendors/VendorTransactions";
import { giveItemsToCharacter } from "../economy/EconomyHelpers";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date();

  const base: CharacterState = {
    id: "char_test_econ_1",
    userId: "user_test_1",
    shardId: "prime_shard",
    name: "Economy Tester",
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
      if (slot?.itemId === itemId) total += Number(slot.qty ?? 0);
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

test("[behavior] economy v0: vendor buy spends gold and grants items", () => {
  const char = makeChar();
  const vendor = makeVendor();

  setGold(char.inventory, 10);
  assert.equal(getGold(char.inventory), 10);

  const beforePotion = countItem(char.inventory, "potion_heal_minor");

  const res = buyFromVendor(char, vendor, 1, 2);
  assert.equal(res.ok, true, res.message);

  assert.equal(getGold(char.inventory), 4);
  assert.equal(countItem(char.inventory, "potion_heal_minor"), beforePotion + 2);
});

test("[behavior] economy v0: vendor buy rejects when you can't afford", () => {
  const char = makeChar();
  const vendor = makeVendor();

  setGold(char.inventory, 2);
  const beforePotion = countItem(char.inventory, "potion_heal_minor");

  const res = buyFromVendor(char, vendor, 1, 1);
  assert.equal(res.ok, false);
  assert.match(res.message, /afford|cost/i);

  assert.equal(getGold(char.inventory), 2);
  assert.equal(countItem(char.inventory, "potion_heal_minor"), beforePotion);
});

test("[behavior] economy v0: vendor sell consumes items and pays half price", () => {
  const char = makeChar();
  const vendor = makeVendor();

  setGold(char.inventory, 0);

  const give = giveItemsToCharacter(char, [{ itemId: "rat_tail", quantity: 3 }]);
  assert.equal(give.failed.length, 0);

  const before = countItem(char.inventory, "rat_tail");
  assert.equal(before, 3);

  const res = sellToVendor(char, "rat_tail", 3, vendor);
  assert.equal(res.ok, true, res.message);

  // priceGold=2 => pays floor(2*0.5)=1 each => 3 gold.
  assert.equal(getGold(char.inventory), 3);
  assert.equal(countItem(char.inventory, "rat_tail"), 0);
});

test("[behavior] economy v0: vendor refuses to buy items it doesn't sell", () => {
  const char = makeChar();
  const vendor = makeVendor();

  giveItemsToCharacter(char, [{ itemId: "mystery_rock", quantity: 1 }]);

  const goldBefore = getGold(char.inventory);
  const res = sellToVendor(char, "mystery_rock", 1, vendor);

  assert.equal(res.ok, false);
  assert.match(res.message, /not interested|buy/i);
  assert.equal(getGold(char.inventory), goldBefore);
});
