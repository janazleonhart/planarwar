-- worldcore/infra/schema/007_items.sql

CREATE TABLE IF NOT EXISTS items (
    -- Canonical item id, e.g. "ore_iron_hematite"
    id              TEXT PRIMARY KEY,

    -- Grouping key, e.g. "ore_iron", "herb_common", "food"
    item_key        TEXT NOT NULL,

    -- Display info
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,

    -- Rarity: "common", "uncommon", "rare", "legendary", "mythic", etc.
    rarity          TEXT NOT NULL,

    -- High-level category for gameplay / UI (“herb”, “ore”, “mana”, “food”, “gear”, etc.)
    category        TEXT,

    -- Optional specialization hook for the city builder side
    specialization_id TEXT,

    -- Optional icon reference for later UI
    icon_id         TEXT,

    -- Max stack size for inventory; resources will usually be 99+
    max_stack       INTEGER NOT NULL DEFAULT 99,

    -- Generic flags (bind-on-pickup, soulbound, quest_item, etc.)
    flags           JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Gameplay stats blob (damage, armor, bonuses, etc.) – empty for pure resources for now
    stats           JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_key
  ON items (item_key);

CREATE INDEX IF NOT EXISTS idx_items_category
  ON items (category);

CREATE INDEX IF NOT EXISTS idx_items_rarity
  ON items (rarity);
