-- worldcore/infra/schema/053_seed_basic_loot_items_v1.sql
--
-- Minimal item seeds required by early loot + tradeskill seeds.
-- This prevents seed drift where npc_loot/skin_loot/trade_recipe_inputs reference item ids
-- that are not present in items seeds.
--
-- Idempotent UPSERT keyed by items(id).

BEGIN;

INSERT INTO items (
  id, item_key, name, description, rarity, category,
  specialization_id, icon_id, max_stack, flags, stats
) VALUES
  (
    'ore_iron_hematite',
    'ore_iron',
    'Hematite Ore',
    'A common iron-bearing ore used in basic smelting.',
    'common',
    'ore',
    'spec_ore_iron',
    NULL,
    99,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'rat_tail',
    'rat',
    'Rat Tail',
    'A scraggly tail from a town rat. Not prestigious, but it is a tail.',
    'common',
    'loot',
    NULL,
    NULL,
    99,
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    'rat_meat_raw',
    'rat',
    'Raw Rat Meat',
    'Uncooked rat meat. Cooking recommended. Sanity optional.',
    'common',
    'food_raw',
    NULL,
    NULL,
    99,
    '{}'::jsonb,
    '{}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  item_key          = EXCLUDED.item_key,
  name              = EXCLUDED.name,
  description       = EXCLUDED.description,
  rarity            = EXCLUDED.rarity,
  category          = EXCLUDED.category,
  specialization_id = EXCLUDED.specialization_id,
  icon_id           = EXCLUDED.icon_id,
  max_stack         = EXCLUDED.max_stack,
  flags             = EXCLUDED.flags,
  stats             = EXCLUDED.stats;

COMMIT;
