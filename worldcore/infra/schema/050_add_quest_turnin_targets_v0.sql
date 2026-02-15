-- worldcore/infra/schema/050_add_quest_turnin_targets_v0.sql
-- Add optional turn-in target bindings for quests.

ALTER TABLE public.quests
  ADD COLUMN IF NOT EXISTS turnin_npc_id text NULL,
  ADD COLUMN IF NOT EXISTS turnin_board_id text NULL;

-- Helpful lookup indexes (optional but cheap)
CREATE INDEX IF NOT EXISTS idx_quests_turnin_npc_id ON public.quests (turnin_npc_id);
CREATE INDEX IF NOT EXISTS idx_quests_turnin_board_id ON public.quests (turnin_board_id);
