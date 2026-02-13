-- worldcore/infra/schema/078_spawn_points_ownership_v0.sql

-- Spawn point ownership/source metadata (v0).
-- Enables reconciliation: planners can avoid overwriting editor-owned rows.

ALTER TABLE spawn_points
  ADD COLUMN IF NOT EXISTS owner_kind TEXT,
  ADD COLUMN IF NOT EXISTS owner_id TEXT,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE spawn_points
  ADD COLUMN IF NOT EXISTS source_kind TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_rev TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spawn_points_owner_kind_chk'
  ) THEN
    ALTER TABLE spawn_points
      ADD CONSTRAINT spawn_points_owner_kind_chk
      CHECK (
        owner_kind IS NULL OR owner_kind IN ('brain','baseline','editor','system')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_spawn_points_owner_kind
  ON spawn_points (owner_kind);

CREATE INDEX IF NOT EXISTS idx_spawn_points_source_kind_id
  ON spawn_points (source_kind, source_id);
