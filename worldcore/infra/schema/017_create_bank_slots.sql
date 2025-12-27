--- worldcore/infra/schema/017_create_bank_slots.sql

CREATE TABLE IF NOT EXISTS bank_slots (
  owner_id   text NOT NULL,
  slot_index integer NOT NULL,
  item_id    text NOT NULL,
  qty        integer NOT NULL,
  meta       jsonb,

  PRIMARY KEY (owner_id, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_bank_slots_owner
  ON bank_slots (owner_id);
