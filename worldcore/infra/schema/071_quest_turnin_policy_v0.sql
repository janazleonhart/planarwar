--- worldcore/infra/schema/071_quest_turnin_policy_v0.sql
-- Questloop v0.2: quest turn-in policy.
--
-- Policy:
--  - anywhere (legacy): can turn in from anywhere.
--  - board: must be in a town/board context; optionally bound to a specific town/region id.
--  - npc: must be standing with a specific NPC (proto id) in the current room.

ALTER TABLE quests
  ADD COLUMN IF NOT EXISTS turnin_policy TEXT NOT NULL DEFAULT 'anywhere',
  ADD COLUMN IF NOT EXISTS turnin_npc_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS turnin_board_id TEXT NULL;

-- Guardrail: keep turnin_policy in a small allowed set.
DO $$
BEGIN
  -- If the constraint already exists, skip.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quests_turnin_policy_chk'
  ) THEN
    ALTER TABLE quests
      ADD CONSTRAINT quests_turnin_policy_chk
      CHECK (turnin_policy IN ('anywhere', 'board', 'npc'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS quests_turnin_policy_idx ON quests(turnin_policy);
CREATE INDEX IF NOT EXISTS quests_turnin_npc_id_idx ON quests(turnin_npc_id);
CREATE INDEX IF NOT EXISTS quests_turnin_board_id_idx ON quests(turnin_board_id);
