-- worldcore/infra/schema/079_service_heartbeats_v0.sql
--
-- Service heartbeats (v0).
-- Lightweight liveness/readiness + last-status snapshot storage for daemons (Mother Brain, etc.).
-- Intended to be polled by admin endpoints (web-backend) rather than requiring each daemon to host HTTP.

CREATE TABLE IF NOT EXISTS service_heartbeats (
  service_name TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  host TEXT NOT NULL,
  pid INTEGER NOT NULL,

  version TEXT,
  mode TEXT,

  ready BOOLEAN NOT NULL DEFAULT FALSE,

  last_tick BIGINT,
  last_signature TEXT,

  last_status_json JSONB,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_tick_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_heartbeats_last_tick_at
  ON service_heartbeats (last_tick_at DESC);

