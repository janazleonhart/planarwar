// worldcore/test/contract_petGear_persistence.test.ts
//
// Contract: pet gear uses real items moved from player bags, persists under
// character.progression.flags.pet.gear, and can be unequipped back to bags.

import test from "node:test";
import assert from "node:assert/strict";

import { petEquipFirstMatchingFromBags, petUnequipToBags } from "../items/petEquipmentOps";

type AnyChar = any;

function makeChar(): AnyChar {
  return {
    id: "char.petgear.1",
    userId: "user.1",
    shardId: "prime_shard",
    name: "PetGearTester",
    classId: "hunter",
    level: 10,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: "0,0",
    inventory: {
      bags: [
        {
          bagId: "bag.1",
          size: 6,
          // slot 0 has a mainhand item, rest empty
          slots: [
            { itemId: "starter_sword_1", qty: 1 },
            null,
            null,
            null,
            null,
            null,
          ],
        },
      ],
    },
    progression: { flags: { pet: { active: true, protoId: "pet_wolf", autoSummon: true } } },
  };
}

function makeCtx() {
  const patches: any[] = [];
  const ctx: any = {
    session: { identity: { userId: "user.1" } },
    characters: {
      async patchCharacter(userId: string, charId: string, patch: any) {
        patches.push({ userId, charId, patch });
        return { ok: true };
      },
    },
    mail: {
      async sendSystemMail() {
        // no-op
      },
    },
    __patches: patches,
  };
  return ctx;
}

test("[contract] pet gear: equip moves item from bags into progression.flags.pet.gear + persists", async () => {
  const ctx = makeCtx();
  const char = makeChar();

  const msg = await petEquipFirstMatchingFromBags(ctx, char, "mainhand");
  assert.ok(String(msg).toLowerCase().includes("equip"), `expected equip message, got: ${msg}`);

  // Item removed from bags
  assert.equal(char.inventory.bags[0].slots[0], null, "bag slot should be cleared on equip");

  // Gear stored under progression flags
  const gear = char.progression?.flags?.pet?.gear;
  assert.ok(gear && typeof gear === "object", "expected pet.gear object");
  assert.equal(gear.mainhand?.itemId, "starter_sword_1");

  // Persist called with progression + inventory
  assert.equal(ctx.__patches.length, 1, "expected one patch call");
  const p = ctx.__patches[0];
  assert.equal(p.userId, "user.1");
  assert.equal(p.charId, "char.petgear.1");
  assert.ok(p.patch.progression, "expected progression in patch");
  assert.ok(p.patch.inventory, "expected inventory in patch");
});

test("[contract] pet gear: unequip moves item back into bags + clears progression.flags.pet.gear", async () => {
  const ctx = makeCtx();
  const char = makeChar();

  // Equip first
  await petEquipFirstMatchingFromBags(ctx, char, "mainhand");

  // Unequip should put it back into bags (we have free slots)
  const msg = await petUnequipToBags(ctx, char, "mainhand");
  assert.ok(String(msg).toLowerCase().includes("unequip"), `expected unequip message, got: ${msg}`);

  const gear = char.progression?.flags?.pet?.gear;
  assert.ok(gear && typeof gear === "object");
  assert.equal(gear.mainhand, null, "pet gear slot should be cleared");

  const bagSlots = char.inventory.bags[0].slots;
  const hasSword = bagSlots.some((s: any) => s?.itemId === "starter_sword_1");
  assert.ok(hasSword, "expected starter_sword_1 to be back in a bag slot");

  // Two patch calls total (equip + unequip)
  assert.equal(ctx.__patches.length, 2, "expected two patch calls");
});
