--- worldcore/infra/schema/024_npcs.sql

CREATE TABLE npcs (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  level     INT  NOT NULL DEFAULT 1,
  max_hp    INT  NOT NULL,
  dmg_min   INT  NOT NULL,
  dmg_max   INT  NOT NULL,
  model     TEXT,
  tags      TEXT[] NOT NULL DEFAULT '{}',
  xp_reward INT    NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE npc_loot (
  npc_id   TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  idx      INT  NOT NULL,
  item_id  TEXT NOT NULL,
  chance   DOUBLE PRECISION NOT NULL,
  min_qty  INT  NOT NULL,
  max_qty  INT  NOT NULL,
  PRIMARY KEY (npc_id, idx)
);
