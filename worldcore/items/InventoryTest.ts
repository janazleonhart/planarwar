//worldcore/items/InventoryTest.ts

import { defaultInventory } from "../characters/CharacterTypes";
import { ItemService } from "./ItemService";
import { addItemToBags } from "./InventoryHelpers";
import { removeItemFromBags } from "./InventoryRemove";

async function run() {
  const items = new ItemService();
  await items.loadAll(); // or stub if DB empty

  const inv = defaultInventory();

  console.log("=== TEST 1: add simple item ===");
  items.addToInventory(inv, "herb_peacebloom", 5);
  console.dir(inv.bags, { depth: 5 });

  console.log("=== TEST 2: stack + overflow ===");
  items.addToInventory(inv, "herb_peacebloom", 50000); // should overflow
  console.dir(inv.bags, { depth: 5 });

  console.log("=== TEST 3: remove items ===");
  const r = items.removeFromInventory(inv, "herb_peacebloom", 50);
  console.log("Removed:", r);
  console.dir(inv.bags, { depth: 5 });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
