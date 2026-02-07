-- worldcore/infra/schema/066_server_events_v1.sql
--
-- Server Events v1
--
-- Purpose:
--   A minimal scheduling substrate for global events (weekend buffs,
--   donation-driven perks, seasonal flags) that can be authored/administered
--   and safely reloaded after restarts.
--
-- This v1 schema supports:
--   - server_events: event envelope (enabled, time window)
--   - server_event_effects: a list of typed effects attached to an event
--
-- v1 intentionally avoids complex recurrence. That can be layered later
-- (e.g., RRULE-like JSON in metadata).

BEGIN;

CREATE TABLE IF NOT EXISTS server_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_events_enabled_time
  ON server_events (enabled, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS server_event_effects (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
  effect_kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_event_effects_event
  ON server_event_effects (event_id);

CREATE INDEX IF NOT EXISTS idx_server_event_effects_kind
  ON server_event_effects (effect_kind);

-- Keep updated_at honest.
CREATE OR REPLACE FUNCTION server_events_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_server_events_touch_updated_at ON server_events;
CREATE TRIGGER trg_server_events_touch_updated_at
BEFORE UPDATE ON server_events
FOR EACH ROW
EXECUTE FUNCTION server_events_touch_updated_at();

COMMIT;
