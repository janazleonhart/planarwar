--- worldcore/infra/schema/021_quests.sql

-- core quest definition
CREATE TABLE quests (
  id            TEXT PRIMARY KEY,           -- 'rat_tail_collection'
  name          TEXT NOT NULL,             -- 'Rat Tail Collection'
  description   TEXT NOT NULL DEFAULT '',  -- long form text / log tooltip

  repeatable    BOOLEAN NOT NULL DEFAULT FALSE,
  max_repeats   INTEGER,                   -- NULL = infinite

  min_level     INTEGER,                   -- optional requirement
  category      TEXT,                      -- 'story', 'bounty', 'repeatable', etc.
  tags          TEXT[] DEFAULT '{}',       -- free-form: ['starter','rat','alchemist']

  is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,

  designer      TEXT,                      -- 'Rimuru', 'SpouseName'
  notes         TEXT,                      -- GM-only notes

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX quests_category_idx ON quests(category);
CREATE INDEX quests_tags_gin_idx ON quests USING GIN(tags);
