// worldcore/test/gatherFallbackLoot.test.ts
//
// Contract: Generic resource nodes (with no explicit proto.loot) must still
// grant fallback loot. This test covers the mining path.
//
// Important:
// - applyGenericResourceLoot is async (it can mail overflow), so this test MUST await it.
// - The gather pipeline delivers loot via OverflowDelivery (bags first, optional mail).

import test from "node:test";
import assert from "node:assert/strict";

import { applyGenericResourceLoot } from "../mud/actions/MudWorldActions";

function makeEmptyInventory(): any {
  const size = 12;
  return {
    bags: [
      {
        id: "bag_basic",
        size,
        // Slots array length matters: InventoryHelpers iterates bag.slots.length
        slots: Array.from({ length: size }, () => null),
      },
    ],
  };
}

function getAllBagStacks(inv: any): any[] {
  const out: any[] = [];
  for (const b of inv?.bags ?? []) {
    for (const s of b?.slots ?? []) {
      if (s) out.push(s);
    }
  }
  return out;
}

test("Generic resource fallback loot: mining yields 2-5 Hematite Ore", async () => {
  const lootLines: string[] = [];

  const inventory = makeEmptyInventory();
  const char: any = { id: "char_test", inventory };

  // Minimal ctx shim: resolveItem(ctx.items, ...) must return a template.
  // We provide the fields resolveItem/describe paths commonly rely on.
  const ctx: any = {
    session: { id: "sess_test", identity: { userId: "user_test" } },
    items: {
      has: (id: string) => id === "ore_iron_hematite",
      get: (id: string) =>
        id === "ore_iron_hematite"
          ? {
              id,
              name: "Hematite Ore",
              maxStack: 20,
              slot: "material",
            }
          : undefined,
    },
    // No mail service needed for this test; bags have plenty of space.
    mail: undefined,
  };

  // NOTE: await is the whole point.
  await applyGenericResourceLoot(ctx, char, "mining", "resource_ore", lootLines, "a vein");

  const stacks = getAllBagStacks(inventory);
  assert.equal(stacks.length, 1, "Expected one stack added to bags");

  const stack = stacks[0];
  assert.equal(stack.itemId, "ore_iron_hematite");
  assert.ok(
    stack.qty >= 2 && stack.qty <= 5,
    `Expected qty 2..5, got ${stack.qty}`,
  );

  assert.equal(lootLines.length, 1, "Expected one loot line");
  assert.ok(lootLines[0].includes("Hematite"), "Loot line should include the item name");
  assert.ok(!lootLines[0].includes("(via mail)"), "Should not mail when bags have space");
});
