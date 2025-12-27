-- worldcore/infra/schema/004_spawn_points.sql

CREATE TABLE IF NOT EXISTS spawn_points (
    id SERIAL PRIMARY KEY,
    shard_id TEXT REFERENCES shards(shard_id) ON DELETE CASCADE,
    spawn_id TEXT NOT NULL,
    type TEXT NOT NULL,
    archetype TEXT NOT NULL,
    x REAL, y REAL, z REAL,
    region_id TEXT
);
