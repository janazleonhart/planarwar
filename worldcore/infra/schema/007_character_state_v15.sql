-- CharacterState v1.5 (JSONB scaffolding)
-- Safe to run multiple times.

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS attributes  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS inventory   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS equipment   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS spellbook   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS abilities   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS progression JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS state_version INT NOT NULL DEFAULT 1;

-- Optional: quick query to confirm
-- SELECT id, state_version, attributes, inventory FROM characters LIMIT 1;
