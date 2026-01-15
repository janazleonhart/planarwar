// worldcore/tradeskills/TradeRecipeService.ts
//
// DB-backed recipe registry (authoritative) with safe fallback to RecipeCatalog.

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

import { listAllRecipes as listStaticRecipes } from "./RecipeCatalog";
import type { TradeRecipe } from "./RecipeTypes";

type TradeRecipeRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  station_kind?: string | null;
};

type TradeRecipeInputRow = {
  recipe_id: string;
  item_id: string;
  qty: number;
};

type TradeRecipeOutputRow = {
  recipe_id: string;
  item_id: string;
  qty: number;
};

export class TradeRecipeService {
  private readonly log = Logger.scope("RECIPES");

  private loaded = false;
  private loading: Promise<void> | null = null;

  // DB recipes (authoritative) keyed by id.
  private dbRecipesById = new Map<string, TradeRecipe>();

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = this.loadAllFromDb().finally(() => {
        this.loaded = true;
      });
    }
    await this.loading;
  }

  /**
   * Returns merged list:
   * - DB overrides code
   * - code fills gaps during migration
   */
  async listAll(): Promise<TradeRecipe[]> {
    await this.ensureLoaded();
    return Array.from(this.mergedRecipeMap().values());
  }

  async get(id: string): Promise<TradeRecipe | undefined> {
    await this.ensureLoaded();
    return this.mergedRecipeMap().get(id);
  }

  async findByIdOrName(token: string): Promise<TradeRecipe | undefined> {
    await this.ensureLoaded();

    const merged = this.mergedRecipeMap();

    // 1) by id
    const byId = merged.get(token);
    if (byId) return byId;

    // 2) by exact name (case-insensitive)
    const lower = token.toLowerCase();
    for (const r of merged.values()) {
      if (r.name.toLowerCase() === lower) return r;
    }

    return undefined;
  }

  async hasDbRecipes(): Promise<boolean> {
    await this.ensureLoaded();
    return this.dbRecipesById.size > 0;
  }

  // -----------------------------
  // internals
  // -----------------------------

  private mergedRecipeMap(): Map<string, TradeRecipe> {
    const merged = new Map<string, TradeRecipe>();

    // Start with static catalog
    for (const r of listStaticRecipes()) {
      merged.set(r.id, r);
    }

    // DB overrides static
    for (const [id, r] of this.dbRecipesById.entries()) {
      merged.set(id, r);
    }

    return merged;
  }

  private async loadAllFromDb(): Promise<void> {
    try {
      this.log.info("Loading trade recipes from DB...");

      const recipesRes = await db.query(
        `SELECT id, name, category, description, station_kind
         FROM trade_recipes
         ORDER BY id ASC`,
      );

      const recipes = (recipesRes.rows ?? []) as TradeRecipeRow[];
      if (recipes.length === 0) {
        this.dbRecipesById = new Map();
        this.log.info("No DB recipes found; using static RecipeCatalog fallback.");
        return;
      }

      const ids = recipes.map((r) => r.id);

      const inputsRes = await db.query(
        `SELECT recipe_id, item_id, qty
         FROM trade_recipe_inputs
         WHERE recipe_id = ANY($1::text[])
         ORDER BY recipe_id ASC, item_id ASC`,
        [ids],
      );

      const outputsRes = await db.query(
        `SELECT recipe_id, item_id, qty
         FROM trade_recipe_outputs
         WHERE recipe_id = ANY($1::text[])
         ORDER BY recipe_id ASC, item_id ASC`,
        [ids],
      );

      const inputs = (inputsRes.rows ?? []) as TradeRecipeInputRow[];
      const outputs = (outputsRes.rows ?? []) as TradeRecipeOutputRow[];

      const map = new Map<string, TradeRecipe>();

      for (const r of recipes) {
        map.set(r.id, {
          id: r.id,
          name: r.name,
          category: r.category as any,
          description: r.description,
          inputs: [],
          outputs: [],
          stationKind: r.station_kind ?? null,
        });
      }

      for (const i of inputs) {
        const rr = map.get(i.recipe_id);
        if (!rr) continue;
        rr.inputs.push({ itemId: i.item_id, qty: Number(i.qty) });
      }

      for (const o of outputs) {
        const rr = map.get(o.recipe_id);
        if (!rr) continue;
        rr.outputs.push({ itemId: o.item_id, qty: Number(o.qty) });
      }

      this.dbRecipesById = map;
      this.log.success("Loaded DB recipes", { count: this.dbRecipesById.size });
    } catch (err: any) {
      // If tables/columns aren't applied yet, don't brick the server/tools.
      this.dbRecipesById = new Map();
      this.log.warn("Failed to load DB recipes; using static RecipeCatalog fallback", {
        err: String(err?.message ?? err),
      });
    }
  }
}

let _svc: TradeRecipeService | null = null;

export function getTradeRecipeService(): TradeRecipeService {
  if (!_svc) _svc = new TradeRecipeService();
  return _svc;
}
