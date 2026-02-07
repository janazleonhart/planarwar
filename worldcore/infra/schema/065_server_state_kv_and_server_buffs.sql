-- worldcore/infra/schema/065_server_state_kv_and_server_buffs.sql
-- Planar War – persisted server-wide state + buffs

-- General-purpose server/global key/value knobs.
CREATE TABLE IF NOT EXISTS server_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_kv_updated_at ON server_kv (updated_at);

-- Persisted server-wide StatusEffects.
-- Logical id is used by admin commands and becomes effect_id = 'server_buff:' || id on characters.
CREATE TABLE IF NOT EXISTS server_buffs (
  id TEXT PRIMARY KEY,
  name TEXT NULL,
  effect_id TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  source_kind TEXT NOT NULL DEFAULT 'environment',
  source_id TEXT NOT NULL DEFAULT 'server',
  modifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NULL,
  max_stacks INT NULL,
  initial_stacks INT NULL,
  created_by TEXT NULL,
  revoked_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_buffs_active ON server_buffs (revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_server_buffs_applied_at ON server_buffs (applied_at);
CREATE INDEX IF NOT EXISTS idx_server_buffs_tags ON server_buffs USING GIN (tags);
