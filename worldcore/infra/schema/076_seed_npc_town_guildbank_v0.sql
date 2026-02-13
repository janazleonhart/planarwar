-- worldcore/infra/schema/076_seed_npc_town_guildbank_v0.sql
-- Seed baseline guild bank service NPC.
--
-- Rationale:
--  - serviceGates supports the 'guildbank' service.
--  - TownBaselinePlanner can optionally seed a guild bank anchor as an NPC spawn.
--
-- Idempotent: safe to run multiple times.

INSERT INTO npcs (id, name, level, max_hp, dmg_min, dmg_max, model, tags, xp_reward)
VALUES
  (
    'town_guildbank_clerk',
    'Guild Bank Clerk',
    1,
    160,
    0,
    0,
    'human_commoner',
    ARRAY['guildbank','service_guildbank','protected_service','non_hostile','protected_town','law_protected'],
    0
  )
ON CONFLICT (id) DO UPDATE
SET
  name      = EXCLUDED.name,
  level     = EXCLUDED.level,
  max_hp    = EXCLUDED.max_hp,
  dmg_min   = EXCLUDED.dmg_min,
  dmg_max   = EXCLUDED.dmg_max,
  model     = EXCLUDED.model,
  tags      = EXCLUDED.tags,
  xp_reward = EXCLUDED.xp_reward;
