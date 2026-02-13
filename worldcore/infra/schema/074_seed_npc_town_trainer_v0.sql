-- worldcore/infra/schema/074_seed_npc_town_trainer_v0.sql
-- Seed a baseline Trainer service NPC.
--
-- Rationale:
--  - The `train` command and serviceGates use proximity to a trainer *service anchor*.
--  - Seeding a trainer proto in DB makes this world-authorable and avoids name-matching hacks.
--
-- Tags:
--  - service_trainer: recognized by serviceGates as a trainer anchor.
--  - protected_service/law_protected: future-proof for justice/guard logic.
--
-- Idempotent: safe to run multiple times.

INSERT INTO npcs (id, name, level, max_hp, dmg_min, dmg_max, model, tags, xp_reward)
VALUES
  (
    'town_trainer',
    'Town Trainer',
    1,
    120,
    0,
    0,
    'human_commoner',
    ARRAY['trainer','service_trainer','protected_service','non_hostile','protected_town','law_protected'],
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
