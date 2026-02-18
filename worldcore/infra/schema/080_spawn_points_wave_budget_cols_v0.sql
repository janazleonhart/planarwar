-- worldcore/infra/schema/080_spawn_points_wave_budget_cols_v0.sql
--
-- Mother Brain wave-budgeting needs a few lightweight, query-friendly columns on spawn_points.
--
-- NOTE:
-- - Many dev DBs were created before spawn_points carried these fields.
-- - Keep this migration idempotent and non-destructive.
-- - We do NOT force NOT NULL constraints here because older rows may need manual backfill.

BEGIN;

ALTER TABLE spawn_points
  ADD COLUMN IF NOT EXISTS shard_id TEXT;

ALTER TABLE spawn_points
  ADD COLUMN IF NOT EXISTS spawn_id TEXT;

ALTER TABLE spawn_points
  ADD COLUMN IF NOT EXISTS type TEXT;

-- Helpful indexes for Mother Brain probes / grouping.
CREATE INDEX IF NOT EXISTS idx_spawn_points_spawn_id
  ON spawn_points (spawn_id);

CREATE INDEX IF NOT EXISTS idx_spawn_points_shard_type
  ON spawn_points (shard_id, type);

-- Optional: fast path for the "brain:*" convention.
CREATE INDEX IF NOT EXISTS idx_spawn_points_brain_spawn_id
  ON spawn_points (spawn_id)
  WHERE spawn_id LIKE 'brain:%';

COMMIT;
