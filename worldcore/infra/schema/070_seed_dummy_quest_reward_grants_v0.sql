-- worldcore/infra/schema/070_seed_dummy_quest_reward_grants_v0.sql
-- Dummy/Dev seed quests to exercise the Rank/Train/Quest Grants pipeline.
--
-- These quests are intentionally simple:
--  - Objective: kill 1x training_dummy
--  - Rewards: spell_grant / ability_grant via quest_rewards.kind + extra_json
--
-- Idempotent: deletes + reinserts objectives/rewards for these quest ids.

BEGIN;

-- ----------------------------
-- Quests
-- ----------------------------
INSERT INTO quests (id, name, description, repeatable, max_repeats, min_level, category, tags, is_enabled, designer, notes)
VALUES
  (
    'debug_q_grant_arcane_bolt',
    'Debug: Grant Arcane Bolt',
    'Dev quest to test spell_grant rewards. Kill a Training Dummy, then turn in to receive a pending spell grant.',
    TRUE,
    NULL,
    1,
    'debug',
    ARRAY['debug','grant','spell_grant','pipeline'],
    TRUE,
    'system',
    'Dev-only seed quest used to validate quest reward grant pipeline.'
  ),
  (
    'debug_q_grant_mage_fire_bolt',
    'Debug: Grant Fire Bolt',
    'Dev quest to test spell_grant rewards for a class spell. Kill a Training Dummy, then turn in to receive a pending spell grant.',
    TRUE,
    NULL,
    1,
    'debug',
    ARRAY['debug','grant','spell_grant','pipeline','mage'],
    TRUE,
    'system',
    'Dev-only seed quest used to validate quest reward grant pipeline.'
  ),
  (
    'debug_q_grant_cleric_minor_heal',
    'Debug: Grant Minor Heal',
    'Dev quest to test spell_grant rewards for a healer spell. Kill a Training Dummy, then turn in to receive a pending spell grant.',
    TRUE,
    NULL,
    1,
    'debug',
    ARRAY['debug','grant','spell_grant','pipeline','cleric'],
    TRUE,
    'system',
    'Dev-only seed quest used to validate quest reward grant pipeline.'
  ),
  (
    'debug_q_grant_power_strike',
    'Debug: Grant Power Strike',
    'Dev quest to test ability_grant rewards. Kill a Training Dummy, then turn in to receive a pending ability grant.',
    TRUE,
    NULL,
    1,
    'debug',
    ARRAY['debug','grant','ability_grant','pipeline','warrior'],
    TRUE,
    'system',
    'Dev-only seed quest used to validate quest reward grant pipeline.'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  repeatable = EXCLUDED.repeatable,
  max_repeats = EXCLUDED.max_repeats,
  min_level = EXCLUDED.min_level,
  category = EXCLUDED.category,
  tags = EXCLUDED.tags,
  is_enabled = EXCLUDED.is_enabled,
  designer = EXCLUDED.designer,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ----------------------------
-- Objectives (reset)
-- ----------------------------
DELETE FROM quest_objectives
WHERE quest_id IN (
  'debug_q_grant_arcane_bolt',
  'debug_q_grant_mage_fire_bolt',
  'debug_q_grant_cleric_minor_heal',
  'debug_q_grant_power_strike'
);

INSERT INTO quest_objectives (quest_id, idx, kind, target_id, required, extra_json)
VALUES
  ('debug_q_grant_arcane_bolt', 1, 'kill', 'training_dummy', 1, NULL),
  ('debug_q_grant_mage_fire_bolt', 1, 'kill', 'training_dummy', 1, NULL),
  ('debug_q_grant_cleric_minor_heal', 1, 'kill', 'training_dummy', 1, NULL),
  ('debug_q_grant_power_strike', 1, 'kill', 'training_dummy', 1, NULL);

-- ----------------------------
-- Rewards (reset)
-- ----------------------------
DELETE FROM quest_rewards
WHERE quest_id IN (
  'debug_q_grant_arcane_bolt',
  'debug_q_grant_mage_fire_bolt',
  'debug_q_grant_cleric_minor_heal',
  'debug_q_grant_power_strike'
);

-- Spell grants (pending; learned via trainer)
INSERT INTO quest_rewards (quest_id, kind, amount, item_id, item_qty, title_id, extra_json)
VALUES
  (
    'debug_q_grant_arcane_bolt',
    'spell_grant',
    NULL,
    NULL,
    NULL,
    NULL,
    '{"spellId":"arcane_bolt","source":"quest:debug_q_grant_arcane_bolt"}'::jsonb
  ),
  (
    'debug_q_grant_mage_fire_bolt',
    'spell_grant',
    NULL,
    NULL,
    NULL,
    NULL,
    '{"spellId":"mage_fire_bolt","source":"quest:debug_q_grant_mage_fire_bolt"}'::jsonb
  ),
  (
    'debug_q_grant_cleric_minor_heal',
    'spell_grant',
    NULL,
    NULL,
    NULL,
    NULL,
    '{"spellId":"cleric_minor_heal","source":"quest:debug_q_grant_cleric_minor_heal"}'::jsonb
  );

-- Ability grants (pending; learned via trainer)
INSERT INTO quest_rewards (quest_id, kind, amount, item_id, item_qty, title_id, extra_json)
VALUES
  (
    'debug_q_grant_power_strike',
    'ability_grant',
    NULL,
    NULL,
    NULL,
    NULL,
    '{"abilityId":"power_strike","source":"quest:debug_q_grant_power_strike"}'::jsonb
  );

COMMIT;
