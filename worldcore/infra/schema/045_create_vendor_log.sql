-- worldcore/infra/schema/045_create_vendor_log.sql
-- Vendor transaction audit log (v0).
--
-- Notes:
-- - This is a best-effort operational log. Gameplay must not depend on it.
-- - Unit tests run with WORLDCORE_TEST=1 and will not touch Postgres; the runtime server does.

CREATE TABLE IF NOT EXISTS vendor_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  shard_id TEXT NULL,

  actor_char_id TEXT NULL,
  actor_char_name TEXT NULL,

  vendor_id TEXT NOT NULL,
  vendor_name TEXT NULL,

  action TEXT NOT NULL, -- buy|sell
  item_id TEXT NULL,
  quantity INT NULL,

  unit_price_gold INT NULL,
  total_gold INT NULL,

  gold_before INT NULL,
  gold_after INT NULL,

  result TEXT NOT NULL, -- ok|deny|error
  reason TEXT NULL,

  meta JSONB NULL
);

CREATE INDEX IF NOT EXISTS vendor_log_ts_idx ON vendor_log (ts DESC);
CREATE INDEX IF NOT EXISTS vendor_log_vendor_idx ON vendor_log (vendor_id, ts DESC);
CREATE INDEX IF NOT EXISTS vendor_log_actor_idx ON vendor_log (actor_char_id, ts DESC);