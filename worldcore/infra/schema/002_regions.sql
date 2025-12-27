-- worldcore/infra/schema/002_regions.sql

CREATE TABLE IF NOT EXISTS regions (
    id SERIAL PRIMARY KEY,
    shard_id TEXT REFERENCES shards(shard_id) ON DELETE CASCADE,
    region_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS region_polygons (
    id SERIAL PRIMARY KEY,
    shard_id TEXT REFERENCES shards(shard_id) ON DELETE CASCADE,
    region_id TEXT NOT NULL,
    px REAL NOT NULL,
    pz REAL NOT NULL
);
