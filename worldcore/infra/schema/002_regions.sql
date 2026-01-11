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

-- worldcore/infra/schema/003_region_flags.sql
-- Adds regions.flags (jsonb) for lightweight per-region metadata/rules.
-- Safe to run multiple times.

ALTER TABLE IF EXISTS regions
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Optional helper index if you plan to query on simple booleans often (rare in v1).
-- Example: find all open-PvP regions
-- CREATE INDEX IF NOT EXISTS idx_regions_flags_pvpEnabled
--   ON regions ((flags->>'pvpEnabled'))
--   WHERE (flags ? 'pvpEnabled');
