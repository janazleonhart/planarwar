-- worldcore/infra/schema/010_characters.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS characters (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

    shard_id       TEXT NOT NULL,      -- e.g. "prime_shard"
    name           TEXT NOT NULL,
    class_id       TEXT NOT NULL,      -- "warrior", "virtuoso", etc.
    level          INTEGER NOT NULL DEFAULT 1,
    xp             BIGINT NOT NULL DEFAULT 0,

    pos_x          DOUBLE PRECISION NOT NULL DEFAULT 0,
    pos_y          DOUBLE PRECISION NOT NULL DEFAULT 0,
    pos_z          DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_region_id TEXT,

    appearance_tag TEXT,               -- serialized cosmetics key

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_characters_user
  ON characters(user_id);

CREATE INDEX IF NOT EXISTS idx_characters_user_shard
  ON characters(user_id, shard_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_name_shard
  ON characters (shard_id, lower(name));

ALTER TABLE characters
ADD COLUMN IF NOT EXISTS guild_id UUID REFERENCES guilds(id) ON DELETE SET NULL;