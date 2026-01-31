-- worldcore/infra/schema/052_seed_npcs_training_dummies_and_civilian_v1.sql
-- Seed baseline NPC prototypes that should exist in the database even when code-side defaults exist.
--
-- Rationale:
--  - Training dummies must be explicitly law-exempt in DB so guard/crime logic never reacts to DPS testing.
--  - Tests now use a real protected civilian prototype instead of repurposing training dummies.
--
-- Idempotent: safe to run multiple times.

INSERT INTO npcs (id, name, level, max_hp, dmg_min, dmg_max, model, tags, xp_reward)
VALUES
  (
    'training_dummy',
    'Training Dummy',
    1,
    5000,
    0,
    0,
    'training_dummy',
    ARRAY['training','non_hostile','law_exempt'],
    0
  ),
  (
    'training_dummy_big',
    'Sturdy Training Dummy',
    1,
    20000,
    0,
    0,
    'training_dummy_big',
    ARRAY['training','non_hostile','law_exempt'],
    0
  ),
  (
    'town_civilian',
    'Town Civilian',
    1,
    60,
    0,
    0,
    'human_commoner',
    ARRAY['civilian','non_hostile','protected_town','law_protected'],
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
