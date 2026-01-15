-- worldcore/infra/schema/033_trade_recipes_station_kind.sql
--
-- Tradeskills v1 – Crafting Stations v0
-- Adds optional station requirements to trade_recipes.

BEGIN;

ALTER TABLE trade_recipes
  ADD COLUMN IF NOT EXISTS station_kind TEXT;

-- Optional index (useful once you start filtering recipes by station)
CREATE INDEX IF NOT EXISTS idx_trade_recipes_station_kind
  ON trade_recipes (station_kind);

COMMIT;
