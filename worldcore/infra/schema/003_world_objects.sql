--- worldcore/infra/schema/003_world_objects.sql

CREATE TABLE IF NOT EXISTS world_objects (
    id SERIAL PRIMARY KEY,
    shard_id TEXT REFERENCES shards(shard_id) ON DELETE CASCADE,
    object_id TEXT NOT NULL,
    type TEXT NOT NULL,
    x REAL,
    y REAL,
    z REAL,
    rotY REAL,
    region_id TEXT
);
