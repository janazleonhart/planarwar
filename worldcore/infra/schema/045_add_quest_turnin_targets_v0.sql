-- worldcore/infra/schema/045_add_quest_turnin_targets_v0.sql
-- Quest turn-in policy + targets (v0.2)

ALTER TABLE quests
  ADD COLUMN IF NOT EXISTS turnin_policy   TEXT NOT NULL DEFAULT 'anywhere',
  ADD COLUMN IF NOT EXISTS turnin_npc_id   TEXT,
  ADD COLUMN IF NOT EXISTS turnin_board_id TEXT;

-- Policy constraint (soft enum)
DO $$
BEGIN
  -- drop/recreate for idempotency
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quests_turnin_policy_chk'
  ) THEN
    ALTER TABLE quests DROP CONSTRAINT quests_turnin_policy_chk;
  END IF;

  ALTER TABLE quests
    ADD CONSTRAINT quests_turnin_policy_chk
    CHECK (turnin_policy IN ('anywhere', 'npc', 'board'));
END $$;

-- Helpful indexes for turn-in queries
CREATE INDEX IF NOT EXISTS quests_turnin_policy_idx ON quests(turnin_policy);
CREATE INDEX IF NOT EXISTS quests_turnin_npc_id_idx ON quests(turnin_npc_id);
CREATE INDEX IF NOT EXISTS quests_turnin_board_id_idx ON quests(turnin_board_id);
