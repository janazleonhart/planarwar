-- worldcore/infra/schema/051_add_quest_turnin_board_id_v0.sql
-- Fix: some schema scanners only detect one ADD COLUMN per ALTER TABLE statement.

ALTER TABLE public.quests
  ADD COLUMN IF NOT EXISTS turnin_board_id text NULL;

CREATE INDEX IF NOT EXISTS idx_quests_turnin_board_id ON public.quests (turnin_board_id);
