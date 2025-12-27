--- worldcore/infra/schema/026_add_owner_kind_to_bank.sql

-- Add owner_kind column with a default for existing rows
ALTER TABLE bank_slots
  ADD COLUMN IF NOT EXISTS owner_kind text NOT NULL DEFAULT 'character';

-- Drop old PK and add composite PK with owner_kind
ALTER TABLE bank_slots
  DROP CONSTRAINT IF EXISTS bank_slots_pkey,
  ADD PRIMARY KEY (owner_id, owner_kind, slot_index);

-- Update index to include owner_kind if you want faster lookups
CREATE INDEX IF NOT EXISTS idx_bank_slots_owner_kind
  ON bank_slots (owner_id, owner_kind);
