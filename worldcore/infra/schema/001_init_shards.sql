-- worldcore/infra/schema/001_init_shards.sql

CREATE TABLE IF NOT EXISTS shards (
    shard_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seed BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    world_version INT DEFAULT 1
);
