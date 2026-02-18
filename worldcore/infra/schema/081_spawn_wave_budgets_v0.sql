-- worldcore/infra/schema/081_spawn_wave_budgets_v0.sql
--
-- Optional per-shard/type caps for Mother Brain wave budgeting.
-- Mother Brain can read this table to report remaining budget, and later enforce it.

CREATE TABLE IF NOT EXISTS spawn_wave_budgets (
  shard_id TEXT NOT NULL,
  type TEXT NOT NULL,
  cap INT NOT NULL CHECK (cap >= 0),
  policy TEXT NOT NULL DEFAULT 'hard',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shard_id, type)
);

CREATE INDEX IF NOT EXISTS idx_spawn_wave_budgets_updated_at ON spawn_wave_budgets (updated_at DESC);
