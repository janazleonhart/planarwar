-- worldcore/infra/schema/069_rank_boss_drops_v0_3.sql
--
-- Rank system v0.3: boss drop grants
--
-- Purpose:
-- - Provide DB-backed (and admin-panel friendly) configuration for Rank IV / Ancient
--   unlocks that come from killing specific bosses.
-- - The reward is a *grant* (pending training), not an auto-learn.
--
-- Runtime behavior (see RankBossDropGrantService.ts):
-- - When an NPC with matching npc_proto_id is slain, roll chance.
-- - If success and the player has not received it before, grant pending.

CREATE TABLE IF NOT EXISTS spell_boss_drops (
  id          BIGSERIAL PRIMARY KEY,
  npc_proto_id TEXT NOT NULL,
  spell_id     TEXT NOT NULL,
  chance       DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  source       TEXT,
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS spell_boss_drops_npc_idx ON spell_boss_drops (npc_proto_id);
CREATE INDEX IF NOT EXISTS spell_boss_drops_spell_idx ON spell_boss_drops (spell_id);

CREATE TABLE IF NOT EXISTS ability_boss_drops (
  id           BIGSERIAL PRIMARY KEY,
  npc_proto_id TEXT NOT NULL,
  ability_id   TEXT NOT NULL,
  chance       DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  source       TEXT,
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS ability_boss_drops_npc_idx ON ability_boss_drops (npc_proto_id);
CREATE INDEX IF NOT EXISTS ability_boss_drops_ability_idx ON ability_boss_drops (ability_id);
