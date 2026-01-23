// worldcore/test/contract_vendorTransactions_outOfStockNoSpend.test.ts
//
// Contract: finite-stock vendor item at 0 stock must deny without spending gold or mutating inventory.

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
import type { VendorDefinition, VendorItem } from "../vendors/VendorTypes";
import { buyFromVendor } from "../vendors/VendorTransactions";

function makeChar(overrides: Partial<CharacterState> = {}): CharacterState {
  const now = new Date();
  const base: CharacterState = {
    id: "char_vendor_oos_1",
    userId: "user_test_1",
    shardId: "prime_shard",
    name: "Vendor OOS Tester",
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

function countItem(inv: any, itemId: string): number {
  let total = 0;
  for (const bag of inv?.bags ?? []) {
    for (const slot of bag?.slots ?? []) {
      if (slot?.itemId === itemId) total += Number(slot?.qty ?? 0);
    }
  }
  return total;
}

test("[contract] vendor transactions: out of stock denies with no gold spend and no item grant", () => {
  const char = makeChar();
  setGold(char.inventory, 50);

  const item: VendorItem = {
    id: 1,
    itemId: "potion_heal_minor",
    priceGold: 3,
    basePriceGold: 3,
    stock: 0,
    stockMax: 10,
    econ: null,
  };

  const vendor: VendorDefinition = {
    id: "vendor_test_oos",
    vendorId: "vendor_test_oos",
    name: "Test Vendor",
    items: [item],
  };

  const goldBefore = getGold(char.inventory);
  const itemsBefore = countItem(char.inventory, item.itemId);

  const r = buyFromVendor(char, vendor, 1, 1);

  assert.equal(r.ok, false);
  assert.match(r.message, /out of stock/i);

  const goldAfter = getGold(char.inventory);
  const itemsAfter = countItem(char.inventory, item.itemId);

  assert.equal(goldAfter, goldBefore);
  assert.equal(itemsAfter, itemsBefore);
});
