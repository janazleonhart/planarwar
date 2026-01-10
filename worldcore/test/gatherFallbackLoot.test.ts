// worldcore/test/gatherFallbackLoot.test.ts

import test from "node:test";
import assert from "node:assert/strict";

// We patch resolveItem so we don't depend on the real item DB/service.
import * as resolveItemModule from "../items/resolveItem";
import { applyGenericResourceLoot } from "../mud/actions/MudWorldActions";

test("Generic resource fallback loot: mining yields 2–5 Hematite Ore", () => {
  // Arrange: patch resolveItem to return a simple template
  const templateName = "Test Hematite Ore";
  (resolveItemModule as any).resolveItem = (_items: any, itemId: string) => ({
    id: itemId,
    name: templateName,
  });

  const inventory: any[] = [];
  const lootLines: string[] = [];

  // Very small fake ItemService: only addToInventory is used.
  const ctx: any = {
    items: {
      addToInventory(inv: any[], itemId: string, qty: number) {
        inv.push({ itemId, qty });
        return { added: qty, remaining: 0 };
      },
    },
  };

  const char: any = { inventory };

  // Act: mining with no explicit proto.loot should hit the generic fallback.
  applyGenericResourceLoot(ctx, char, "mining", "resource_ore", lootLines);

  // Assert: we got exactly one stack in inventory
  assert.equal(inventory.length, 1);
  const entry = inventory[0];

  // It should be the mining fallback item
  assert.equal(
    entry.itemId,
    "ore_iron_hematite",
    "Mining fallback should yield ore_iron_hematite"
  );

  // Quantity should be between 2 and 5 inclusive
  assert.ok(
    entry.qty >= 2 && entry.qty <= 5,
    `Expected qty between 2 and 5, got ${entry.qty}`
  );

  // And a human-readable loot line should be produced using our template name
  assert.equal(lootLines.length, 1);
  assert.ok(
    lootLines[0].includes(templateName),
    "Loot line should mention the item name"
  );
});
