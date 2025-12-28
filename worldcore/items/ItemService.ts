// worldcore/items/ItemService.ts

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import { ItemDefinition, ItemRow, rowToItemDefinition } from "./ItemTypes";
import { InventoryState } from "../characters/CharacterTypes";
import { addItemToBags } from "./InventoryHelpers";
import { OverflowPolicy } from "./OverflowPolicy";
import { ItemConfig } from "./ItemConfig";
import { removeItemFromBags, RemoveItemResult } from "./InventoryRemove";

export class ItemService {
  private log = Logger.scope("ITEMS");
  private itemsById = new Map<string, ItemDefinition>();
  private loaded = false;

  /**
   * Load all item definitions from Postgres into memory.
   * Call this once at shard startup.
   */
  async loadAll(): Promise<void> {
    this.log.info("Loading item definitions from DB...");

    const res = await db.query(`SELECT * FROM items`);
    const rows = res.rows as ItemRow[];
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
  }

  ensureLoaded(): void {
    if (!this.loaded) {
      this.log.warn("ItemService used before loadAll() – using empty cache");
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
   * Very small helper for dev commands:
   * - match by id first;
   * - fall back to case-insensitive name match.
   */
  findByIdOrName(token: string): ItemDefinition | undefined {
    this.ensureLoaded();
    const byId = this.itemsById.get(token);
    if (byId) return byId;

    const lower = token.toLowerCase();
    for (const def of this.itemsById.values()) {
      if (def.name.toLowerCase() === lower) return def;
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
      if (def.category === category) out.push(def);
    }
    return out;
  }

  addToInventory(
    inventory: InventoryState,
    itemId: string,
    qty: number,
    overflow: OverflowPolicy = ItemConfig.defaultOverflowPolicy
  ): AddItemResult {
    this.ensureLoaded();
  
    const def = this.itemsById.get(itemId);
    if (!def) {
      throw new Error(`Unknown item '${itemId}'`);
    }
  
    const stackSize = def.maxStack ?? 1;
    const leftover = addItemToBags(inventory, itemId, qty, stackSize);
  
    if (leftover > 0) {
      switch (overflow) {
        case "destroy":
          // do nothing: remainder is lost
          break;
  
        case "mail":
          // TODO: enqueue overflow mail job (future mailbox system)
          // For now fall back to destroy so behavior is deterministic.
          this.log.warn("Overflow mail not implemented; destroying remainder", {
            itemId,
            leftover,
          });
          break;
  
        case "drop":
          // TODO: spawn world drop entity (future world drop system)
          this.log.warn("Overflow drop not implemented; destroying remainder", {
            itemId,
            leftover,
          });
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
    qty: number
  ): RemoveItemResult {
    this.ensureLoaded();
  
    if (!this.itemsById.has(itemId)) {
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