-- worldcore/infra/schema/077_seed_npc_town_inn_v0.sql
-- Seed baseline inn/rest service NPC.
--
-- Rationale:
--  - PW_REST_GATES optionally requires a nearby rest spot / inn anchor.
--  - TownBaselinePlanner can optionally seed an innkeeper anchor as an NPC spawn.
--
-- Idempotent: safe to run multiple times.

INSERT INTO npcs (id, name, level, max_hp, dmg_min, dmg_max, model, tags, xp_reward)
VALUES
  (
    'town_innkeeper',
    'Innkeeper',
    1,
    140,
    0,
    0,
    'human_commoner',
    ARRAY['inn','rest','rest_spot','service_rest','protected_service','non_hostile','protected_town','law_protected'],
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
