-- worldcore/infra/schema/029_seed_crafting_items_v1.sql
--
-- Adds minimal crafted outputs used by Tradeskills v1 RecipeCatalog.
-- Idempotent: safe to re-run.

INSERT INTO items (
  id, item_key, name, description, rarity, category,
  specialization_id, icon_id, max_stack, flags, stats
) VALUES
  (
    'bar_iron_crude',
    'ore_iron',
    'Crude Iron Bar',
    'A rough iron bar smelted from hematite ore.',
    'common',
    'ore',
    'spec_ore_iron',
    NULL,
    99,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'potion_heal_minor',
    'potion_heal',
    'Minor Healing Draught',
    'A simple herbal draught that restores a small amount of health.',
    'common',
    'consumable',
    NULL,
    NULL,
    20,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'food_trout_cooked',
    'food_fish',
    'Cooked River Trout',
    'A freshly cooked trout. Warm, filling, and surprisingly delicious.',
    'common',
    'food',
    'spec_food_fish',
    NULL,
    20,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'food_flour_wheat',
    'food_grain',
    'Wheat Flour',
    'Finely milled wheat flour used for simple baking.',
    'common',
    'food',
    'spec_food_grain',
    NULL,
    99,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'food_bread_simple',
    'food_grain',
    'Simple Bread',
    'Basic bread baked from wheat flour. A staple food.',
    'common',
    'food',
    'spec_food_grain',
    NULL,
    20,
    '{}'::jsonb,
    '{}'::jsonb
  )
  ,
  (
    'hide_scraps',
    'leather_hide',
    'Hide Scraps',
    'Scraps of hide stripped from a small beast. Useful for basic tanning.',
    'common',
    'material',
    NULL,
    NULL,
    99,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'leather_raw',
    'leather',
    'Raw Leather',
    'A rough piece of leather tanned from hide scraps.',
    'common',
    'material',
    NULL,
    NULL,
    99,
    '{}'::jsonb,
    '{}'::jsonb
  )


ON CONFLICT (id) DO UPDATE SET
  item_key = EXCLUDED.item_key,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  rarity = EXCLUDED.rarity,
  category = EXCLUDED.category,
  specialization_id = EXCLUDED.specialization_id,
  icon_id = EXCLUDED.icon_id,
  max_stack = EXCLUDED.max_stack,
  flags = EXCLUDED.flags,
  stats = EXCLUDED.stats,
  updated_at = NOW();
