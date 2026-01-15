-- worldcore/infra/schema/034_seed_trade_recipes_station_kinds_v1.sql
--
-- Tradeskills v1 – seed station_kind for starter recipes.
-- Policy:
-- - campfire is portable (can exist outside towns)
-- - forge / alchemy_table / millstone / oven are town/player-city infrastructure

BEGIN;

UPDATE trade_recipes
SET station_kind = 'forge', updated_at = NOW()
WHERE id = 'smelt_iron_ingot'
  AND station_kind IS DISTINCT FROM 'forge';

UPDATE trade_recipes
SET station_kind = 'alchemy_table', updated_at = NOW()
WHERE id = 'brew_minor_heal'
  AND station_kind IS DISTINCT FROM 'alchemy_table';

UPDATE trade_recipes
SET station_kind = 'campfire', updated_at = NOW()
WHERE id = 'cook_river_trout'
  AND station_kind IS DISTINCT FROM 'campfire';

UPDATE trade_recipes
SET station_kind = 'millstone', updated_at = NOW()
WHERE id = 'mill_wheat_flour'
  AND station_kind IS DISTINCT FROM 'millstone';

UPDATE trade_recipes
SET station_kind = 'oven', updated_at = NOW()
WHERE id = 'bake_simple_bread'
  AND station_kind IS DISTINCT FROM 'oven';

COMMIT;
