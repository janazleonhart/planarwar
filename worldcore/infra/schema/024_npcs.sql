--- worldcore/infra/schema/024_npcs.sql
-- NPC prototype definitions (Postgres).

CREATE TABLE IF NOT EXISTS npcs (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  level     INTEGER NOT NULL DEFAULT 1,
  max_hp    INTEGER NOT NULL DEFAULT 10,
  dmg_min   INTEGER NOT NULL DEFAULT 0,
  dmg_max   INTEGER NOT NULL DEFAULT 0,
  model     TEXT NOT NULL DEFAULT '',
  tags      TEXT[] NOT NULL DEFAULT '{}', -- e.g. {"vendor","guard","non_hostile","law_protected","law_exempt"}
  xp_reward INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_npcs_updated_at ON npcs;
CREATE TRIGGER trg_npcs_updated_at
BEFORE UPDATE ON npcs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Notes on law tags:
--  - "law_exempt" wins over everything: no crime is recorded when attacked.
--  - "law_protected" forces the NPC to be treated as protected (crime when attacked).
--  - If neither tag is present, worldcore falls back to legacy implicit behavior.
