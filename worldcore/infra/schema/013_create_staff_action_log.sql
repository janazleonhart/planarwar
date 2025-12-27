--- worldcore/db/migrations/013_create_staff_action_log.sql

CREATE TABLE IF NOT EXISTS staff_action_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),

  actor_id    text,     -- user id from accounts (string/uuid, so keep it text)
  actor_name  text,     -- display name at time of action

  action_name text NOT NULL,  -- e.g. "event_give_any", "debug_give_mat"
  details     jsonb NOT NULL  -- arbitrary payload
);

CREATE INDEX IF NOT EXISTS idx_staff_action_log_at
  ON staff_action_log (at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_action_log_actor
  ON staff_action_log (actor_id);
