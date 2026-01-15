-- worldcore/infra/schema/035_skin_loot_v1.sql
--
-- Skinning v1: DB-backed loot profiles for corpse skinning.
--
-- Design:
-- - Rows can target a specific NPC proto (npc_proto_id) OR a broad tag (npc_tag), or both.
-- - Resolution order in code: proto rows first, then tag rows (de-duped by item_id).
-- - priority: lower numbers win earlier (useful when multiple rows apply).
-- - chance: per-drop roll (0..1).
-- - min_qty/max_qty: quantity roll.

CREATE TABLE IF NOT EXISTS skin_loot (
    id              BIGSERIAL PRIMARY KEY,

    npc_proto_id    TEXT NULL,
    npc_tag         TEXT NULL,

    item_id         TEXT NOT NULL REFERENCES items(id),

    chance          REAL NOT NULL DEFAULT 1.0 CHECK (chance >= 0.0 AND chance <= 1.0),
    min_qty         INTEGER NOT NULL DEFAULT 1 CHECK (min_qty > 0),
    max_qty         INTEGER NOT NULL DEFAULT 1 CHECK (max_qty >= min_qty),

    priority        INTEGER NOT NULL DEFAULT 100,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (npc_proto_id IS NOT NULL OR npc_tag IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_skin_loot_proto
  ON skin_loot (npc_proto_id);

CREATE INDEX IF NOT EXISTS idx_skin_loot_tag
  ON skin_loot (npc_tag);

CREATE INDEX IF NOT EXISTS idx_skin_loot_item
  ON skin_loot (item_id);
