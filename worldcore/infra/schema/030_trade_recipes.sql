-- worldcore/infra/schema/030_trade_recipes.sql
--
-- Tradeskills v1: DB-backed recipes (authoritative)
--
-- Design:
-- - One recipe row (id/name/category/description)
-- - Inputs + outputs are separate tables
-- - Simple structure now; we can extend later with station requirements, skill, etc.

CREATE TABLE IF NOT EXISTS trade_recipes (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    description     TEXT NOT NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_recipes_category
  ON trade_recipes (category);

CREATE TABLE IF NOT EXISTS trade_recipe_inputs (
    recipe_id       TEXT NOT NULL REFERENCES trade_recipes(id) ON DELETE CASCADE,
    item_id         TEXT NOT NULL REFERENCES items(id),
    qty             INTEGER NOT NULL CHECK (qty > 0),

    PRIMARY KEY (recipe_id, item_id)
);

CREATE TABLE IF NOT EXISTS trade_recipe_outputs (
    recipe_id       TEXT NOT NULL REFERENCES trade_recipes(id) ON DELETE CASCADE,
    item_id         TEXT NOT NULL REFERENCES items(id),
    qty             INTEGER NOT NULL CHECK (qty > 0),

    PRIMARY KEY (recipe_id, item_id)
);
