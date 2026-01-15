-- worldcore/infra/schema/031_seed_trade_recipes_v1.sql
--
-- Tradeskills v1 baseline recipe seeds.
-- Safe to re-run (UPSERT).

-- -----------------------
-- smelt_iron_ingot
-- 5x ore_iron_hematite -> 1x bar_iron_crude
-- -----------------------
INSERT INTO trade_recipes (id, name, category, description)
VALUES (
  'smelt_iron_ingot',
  'Smelt Iron Ingot',
  'smelting',
  'Smelt Hematite Ore into a crude iron ingot.'
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description;

INSERT INTO trade_recipe_inputs (recipe_id, item_id, qty)
VALUES ('smelt_iron_ingot', 'ore_iron_hematite', 5)
ON CONFLICT (recipe_id, item_id) DO UPDATE
SET qty = EXCLUDED.qty;

INSERT INTO trade_recipe_outputs (recipe_id, item_id, qty)
VALUES ('smelt_iron_ingot', 'bar_iron_crude', 1)
ON CONFLICT (recipe_id, item_id) DO UPDATE
SET qty = EXCLUDED.qty;

-- -----------------------
-- brew_minor_heal
-- 3x herb_peacebloom -> 1x potion_heal_minor
-- -----------------------
INSERT INTO trade_recipes (id, name, category, description)
VALUES (
  'brew_minor_heal',
  'Brew Minor Healing Draught',
  'alchemy',
  'Brew a simple healing draught from Peacebloom.'
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description;

INSERT INTO trade_recipe_inputs (recipe_id, item_id, qty)
VALUES ('brew_minor_heal', 'herb_peacebloom', 3)
ON CONFLICT (recipe_id, item_id) DO UPDATE
SET qty = EXCLUDED.qty;

INSERT INTO trade_recipe_outputs (recipe_id, item_id, qty)
VALUES ('brew_minor_heal', 'potion_heal_minor', 1)
ON CONFLICT (recipe_id, item_id) DO UPDATE
SET qty = EXCLUDED.qty;
