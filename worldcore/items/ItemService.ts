// worldcore/items/ItemService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import {
  ItemDefinition,
  ItemRow,
  rowToItemDefinition,
} from "./ItemTypes";
import { InventoryState } from "../characters/CharacterTypes";
import { addItemToBags } from "./InventoryHelpers";
import { OverflowPolicy } from "./OverflowPolicy";
import { ItemConfig } from "./ItemConfig";
import {
  removeItemFromBags,
  RemoveItemResult,
} from "./InventoryRemove";
import { getItemTemplate } from "./ItemCatalog";

export class ItemService {
  private readonly log = Logger.scope("ITEMS");

  private itemsById = new Map<string, ItemDefinition>();
  private loaded = false;

  /**
   * Load all item definitions from Postgres into memory.
   * This is usually called once at shard start-up.
   */
  async loadAll(): Promise<void> {
    this.log.info("Loading item definitions from DB...");

    try {
      const res = await db.query(`SELECT * FROM items`);
      const map = new Map<string, ItemDefinition>();

      for (const row of res.rows as ItemRow[]) {
        const def = rowToItemDefinition(row);
        map.set(def.id, def);
      }

      this.itemsById = map;
      this.loaded = true;

      this.log.success("Loaded item definitions", {
        count: this.itemsById.size,
      });
    } catch (err) {
      // We still flip `loaded` so the shard can boot even if the
      // table is empty or temporarily unavailable.
      this.log.error("Failed to load item definitions", { err });
      this.itemsById = new Map();
      this.loaded = true;
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.log.warn(
        "ItemService used before loadAll() – treating cache as empty",
      );
    }
  }

  get(id: string): ItemDefinition | undefined {
    this.ensureLoaded();
    return this.itemsById.get(id);
  }

  has(id: string): boolean {
    this.ensureLoaded();
    return this.itemsById.has(id);
  }

  /**
   * Helper for dev commands:
   *   - match by id first
   *   - fall back to exact, case-insensitive name match
   *
   * This only searches DB-backed definitions; static bootstrap items
   * live in ItemCatalog and are normally resolved via resolveItem().
   */
  findByIdOrName(token: string): ItemDefinition | undefined {
    this.ensureLoaded();

    const byId = this.itemsById.get(token);
    if (byId) return byId;

    const lower = token.toLowerCase();

    for (const def of this.itemsById.values()) {
      if (def.name.toLowerCase() === lower) {
        return def;
      }
    }

    return undefined;
  }

  listAll(): ItemDefinition[] {
    this.ensureLoaded();
    return Array.from(this.itemsById.values());
  }

  listByCategory(category: string): ItemDefinition[] {
    this.ensureLoaded();

    const out: ItemDefinition[] = [];
    for (const def of this.itemsById.values()) {
      if (def.category === category) {
        out.push(def);
      }
    }

    return out;
  }

  /**
   * Add an item stack to the provided inventory.
   *
   * Behaviour:
   *   - Prefer the Postgres definition (ItemDefinition) if one exists.
   *   - If the DB has no such row, fall back to the static ItemCatalog
   *     entry so dev-only items like early gathering resources still work.
   */
  addToInventory(
    inventory: InventoryState,
    itemId: string,
    qty: number,
    overflow: OverflowPolicy = ItemConfig.defaultOverflowPolicy,
  ): AddItemResult {
    this.ensureLoaded();

    const dbDef = this.itemsById.get(itemId);
    const template = (dbDef as any) ?? getItemTemplate(itemId);

    if (!template) {
      throw new Error(`Unknown item '${itemId}'`);
    }

    const stackSize = template.maxStack ?? 1;
    const leftover = addItemToBags(inventory, itemId, qty, stackSize);

    if (leftover > 0) {
      switch (overflow) {
        case "destroy":
          // Remainder is silently discarded.
          break;

        case "mail":
          // TODO: overflow-by-mail once the mailbox system exists.
          this.log.warn(
            "Overflow mail not implemented; destroying remainder",
            { itemId, leftover },
          );
          break;

        case "drop":
          // TODO: world drops (ground loot) in a later phase.
          this.log.warn(
            "Overflow drop not implemented; destroying remainder",
            { itemId, leftover },
          );
          break;
      }
    }

    return {
      added: qty - leftover,
      leftover,
      overflowPolicy: leftover > 0 ? overflow : undefined,
    };
  }

  removeFromInventory(
    inventory: InventoryState,
    itemId: string,
    qty: number,
  ): RemoveItemResult {
    this.ensureLoaded();

    // Allow removal of both DB-backed and static catalog items.
    if (!this.itemsById.has(itemId) && !getItemTemplate(itemId)) {
      throw new Error(`Unknown item '${itemId}'`);
    }

    return removeItemFromBags(inventory, itemId, qty);
  }
}

export interface AddItemResult {
  added: number;
  leftover: number;
  overflowPolicy?: string;
}
