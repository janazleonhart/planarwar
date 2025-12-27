--- worldcore/infra/schema/022_quest_objectives.sql

-- objective types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'quest_objective_kind'
  ) THEN
    CREATE TYPE quest_objective_kind AS ENUM (
      'kill',
      'harvest',
      'item_turnin',
      'talk_to_npc',
      'visit_room'
    );
  END IF;
END$$;

CREATE TABLE quest_objectives (
  id          BIGSERIAL PRIMARY KEY,
  quest_id    TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,      -- order in quest log
  kind        quest_objective_kind NOT NULL,
  target_id   TEXT NOT NULL,         -- npc proto, item id, room id, etc.
  required    INTEGER NOT NULL DEFAULT 1,

  -- optional extra data (e.g. "factionId", "roomTag", etc.)
  extra_json  JSONB
);

CREATE INDEX quest_objectives_quest_idx ON quest_objectives(quest_id);
