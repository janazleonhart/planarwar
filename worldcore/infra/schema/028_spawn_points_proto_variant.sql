--- worldcore/infra/schema/028_spawn_points_proto_variant.sql

ALTER TABLE spawn_points
  ADD COLUMN IF NOT EXISTS proto_id   TEXT,
  ADD COLUMN IF NOT EXISTS variant_id TEXT;

-- Backfill: treat existing archetype as proto_id if proto_id is missing
UPDATE spawn_points
SET proto_id = archetype
WHERE proto_id IS NULL AND archetype IS NOT NULL;

-- Optional: index for common lookups
CREATE INDEX IF NOT EXISTS idx_spawn_points_shard_region
  ON spawn_points (shard_id, region_id);

CREATE INDEX IF NOT EXISTS idx_spawn_points_proto_variant
  ON spawn_points (proto_id, variant_id);
