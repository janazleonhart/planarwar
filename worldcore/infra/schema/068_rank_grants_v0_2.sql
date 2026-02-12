-- worldcore/infra/schema/068_rank_grants_v0_2.sql
-- Rank system v0.2:
-- - Quest rewards can grant spells/abilities (as pending grants) via quest_rewards.kind + extra_json.
-- - Kill milestones can grant spells/abilities (as pending grants) via *_kill_grants tables.

DO $$
BEGIN
  -- Extend quest_reward_kind enum safely.
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quest_reward_kind') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'quest_reward_kind'
        AND e.enumlabel = 'spell_grant'
    ) THEN
      EXECUTE 'ALTER TYPE quest_reward_kind ADD VALUE ''spell_grant''';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'quest_reward_kind'
        AND e.enumlabel = 'ability_grant'
    ) THEN
      EXECUTE 'ALTER TYPE quest_reward_kind ADD VALUE ''ability_grant''';
    END IF;
  END IF;
END
$$;

-- Kill milestone grant rules.
-- These are intentionally simple and DB-driven.
-- The runtime will treat them as: "when kills[target_proto_id] >= required_kills, grant <id> once".

CREATE TABLE IF NOT EXISTS spell_kill_grants (
  id              BIGSERIAL PRIMARY KEY,
  target_proto_id TEXT NOT NULL,
  required_kills  INTEGER NOT NULL DEFAULT 1,
  spell_id        TEXT NOT NULL,
  source          TEXT,
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS spell_kill_grants_target_idx ON spell_kill_grants(target_proto_id);

CREATE TABLE IF NOT EXISTS ability_kill_grants (
  id              BIGSERIAL PRIMARY KEY,
  target_proto_id TEXT NOT NULL,
  required_kills  INTEGER NOT NULL DEFAULT 1,
  ability_id      TEXT NOT NULL,
  source          TEXT,
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS ability_kill_grants_target_idx ON ability_kill_grants(target_proto_id);
