-- worldcore/infra/schema/037_add_town_tier_v1.sql
-- Option B: persist town tier in DB instead of inferring from spawn_id/variant_id tags.
-- Safe: nullable column; existing code can ignore it until wired.

BEGIN;

ALTER TABLE spawn_points
  ADD COLUMN IF NOT EXISTS town_tier INTEGER;

-- Clamp sensible range via CHECK (Postgres supports NOT VALID to avoid scanning huge tables).
-- If you prefer strict validation immediately, remove NOT VALID + add VALIDATE CONSTRAINT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spawn_points_town_tier_range'
  ) THEN
    ALTER TABLE spawn_points
      ADD CONSTRAINT spawn_points_town_tier_range
      CHECK (town_tier IS NULL OR (town_tier >= 1 AND town_tier <= 5))
      NOT VALID;
  END IF;
END $$;

-- Existing towns default to tier 1 unless you explicitly set them.
UPDATE spawn_points
SET town_tier = COALESCE(town_tier, 1)
WHERE type = 'town';

COMMIT;
