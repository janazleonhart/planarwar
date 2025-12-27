--- worldcore/infra/schema/023_quest_rewards.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'quest_reward_kind'
  ) THEN
    CREATE TYPE quest_reward_kind AS ENUM (
      'xp',
      'gold',
      'item',
      'title'
    );
  END IF;
END$$;

CREATE TABLE quest_rewards (
  id        BIGSERIAL PRIMARY KEY,
  quest_id  TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  kind      quest_reward_kind NOT NULL,

  amount    INTEGER,          -- for xp/gold
  item_id   TEXT,             -- for item
  item_qty  INTEGER,          -- for item (default 1)
  title_id  TEXT,             -- for title unlock

  extra_json JSONB            -- future-flex: AA, city favor, etc.
);

CREATE INDEX quest_rewards_quest_idx ON quest_rewards(quest_id);
