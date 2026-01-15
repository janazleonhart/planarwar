-- worldcore/infra/schema/032_seed_trade_recipes_cooking_v1.sql
--
-- Tradeskills v1 – seed cooking recipes into DB (authoritative)
-- This migrates the remaining starter RecipeCatalog cooking recipes into trade_recipes.

BEGIN;

-- Upsert recipes
INSERT INTO trade_recipes (id, name, category, description)
VALUES
  ('cook_river_trout', 'Cook River Trout', 'cooking', 'Cook a fresh trout into a hearty meal.'),
  ('mill_wheat_flour', 'Mill Wheat Flour', 'cooking', 'Grind wheat into flour for simple baking.'),
  ('bake_simple_bread', 'Bake Simple Bread', 'cooking', 'Bake flour into basic bread. A cornerstone of civilization.')
ON CONFLICT (id) DO UPDATE
SET
  name        = EXCLUDED.name,
  category    = EXCLUDED.category,
  description = EXCLUDED.description,
  updated_at  = NOW();

-- Replace inputs/outputs deterministically (works regardless of UNIQUE constraints)
DELETE FROM trade_recipe_inputs
WHERE recipe_id IN ('cook_river_trout', 'mill_wheat_flour', 'bake_simple_bread');

DELETE FROM trade_recipe_outputs
WHERE recipe_id IN ('cook_river_trout', 'mill_wheat_flour', 'bake_simple_bread');

-- Inputs
INSERT INTO trade_recipe_inputs (recipe_id, item_id, qty)
VALUES
  ('cook_river_trout', 'fish_river_trout', 1),
  ('mill_wheat_flour', 'grain_wheat', 2),
  ('bake_simple_bread', 'food_flour_wheat', 2);

-- Outputs
INSERT INTO trade_recipe_outputs (recipe_id, item_id, qty)
VALUES
  ('cook_river_trout', 'food_trout_cooked', 1),
  ('mill_wheat_flour', 'food_flour_wheat', 1),
  ('bake_simple_bread', 'food_bread_simple', 1);

COMMIT;
