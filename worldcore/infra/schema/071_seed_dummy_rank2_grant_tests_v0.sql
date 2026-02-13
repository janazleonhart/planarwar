-- worldcore/infra/schema/071_seed_dummy_rank2_grant_tests_v0.sql
-- Dev seed: create Rank II spell/ability entries (minimal) and point debug grant quests at them.
--
-- Why:
-- - Rank I can be auto-granted; Rank II+ should exercise the "pending grant -> trainer" pipeline.
-- - We keep this tiny and idempotent so it can live in schema safely.

BEGIN;

-- ----------------------------------------
-- Rank II spells (clone Rank I + tweak)
-- ----------------------------------------

-- Arcane Bolt II (class:any)
INSERT INTO public.spells (
  id, name, description, kind, class_id, min_level, school, is_song, song_school,
  resource_type, resource_cost, cooldown_ms,
  damage_multiplier, flat_bonus, heal_amount,
  status_effect, cleanse,
  is_debug, is_enabled, flags, tags, is_dev_only, grant_min_role,
  rank_group_id, rank, learn_requires_trainer
)
SELECT
  'arcane_bolt_ii' AS id,
  s.name || ' II' AS name,
  s.description AS description,
  s.kind AS kind,
  s.class_id AS class_id,
  GREATEST(s.min_level, 4) AS min_level,
  s.school AS school,
  s.is_song AS is_song,
  s.song_school AS song_school,
  s.resource_type AS resource_type,
  s.resource_cost AS resource_cost,
  s.cooldown_ms AS cooldown_ms,
  COALESCE(s.damage_multiplier, 1.0) + 0.05 AS damage_multiplier,
  COALESCE(s.flat_bonus, 0) + 4 AS flat_bonus,
  s.heal_amount AS heal_amount,
  s.status_effect AS status_effect,
  s.cleanse AS cleanse,
  s.is_debug AS is_debug,
  s.is_enabled AS is_enabled,
  s.flags AS flags,
  s.tags AS tags,
  s.is_dev_only AS is_dev_only,
  s.grant_min_role AS grant_min_role,
  s.rank_group_id AS rank_group_id,
  2 AS rank,
  TRUE AS learn_requires_trainer
FROM public.spells s
WHERE s.id = 'arcane_bolt'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  class_id = EXCLUDED.class_id,
  min_level = EXCLUDED.min_level,
  school = EXCLUDED.school,
  is_song = EXCLUDED.is_song,
  song_school = EXCLUDED.song_school,
  resource_type = EXCLUDED.resource_type,
  resource_cost = EXCLUDED.resource_cost,
  cooldown_ms = EXCLUDED.cooldown_ms,
  damage_multiplier = EXCLUDED.damage_multiplier,
  flat_bonus = EXCLUDED.flat_bonus,
  heal_amount = EXCLUDED.heal_amount,
  status_effect = EXCLUDED.status_effect,
  cleanse = EXCLUDED.cleanse,
  is_debug = EXCLUDED.is_debug,
  is_enabled = EXCLUDED.is_enabled,
  flags = EXCLUDED.flags,
  tags = EXCLUDED.tags,
  is_dev_only = EXCLUDED.is_dev_only,
  grant_min_role = EXCLUDED.grant_min_role,
  rank_group_id = EXCLUDED.rank_group_id,
  rank = EXCLUDED.rank,
  learn_requires_trainer = EXCLUDED.learn_requires_trainer,
  updated_at = now();

-- Fire Bolt II (mage)
INSERT INTO public.spells (
  id, name, description, kind, class_id, min_level, school, is_song, song_school,
  resource_type, resource_cost, cooldown_ms,
  damage_multiplier, flat_bonus, heal_amount,
  status_effect, cleanse,
  is_debug, is_enabled, flags, tags, is_dev_only, grant_min_role,
  rank_group_id, rank, learn_requires_trainer
)
SELECT
  'mage_fire_bolt_ii' AS id,
  s.name || ' II' AS name,
  s.description AS description,
  s.kind AS kind,
  s.class_id AS class_id,
  GREATEST(s.min_level, 4) AS min_level,
  s.school AS school,
  s.is_song AS is_song,
  s.song_school AS song_school,
  s.resource_type AS resource_type,
  s.resource_cost AS resource_cost,
  s.cooldown_ms AS cooldown_ms,
  COALESCE(s.damage_multiplier, 1.0) + 0.05 AS damage_multiplier,
  COALESCE(s.flat_bonus, 0) + 4 AS flat_bonus,
  s.heal_amount AS heal_amount,
  s.status_effect AS status_effect,
  s.cleanse AS cleanse,
  s.is_debug AS is_debug,
  s.is_enabled AS is_enabled,
  s.flags AS flags,
  s.tags AS tags,
  s.is_dev_only AS is_dev_only,
  s.grant_min_role AS grant_min_role,
  s.rank_group_id AS rank_group_id,
  2 AS rank,
  TRUE AS learn_requires_trainer
FROM public.spells s
WHERE s.id = 'mage_fire_bolt'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  class_id = EXCLUDED.class_id,
  min_level = EXCLUDED.min_level,
  school = EXCLUDED.school,
  is_song = EXCLUDED.is_song,
  song_school = EXCLUDED.song_school,
  resource_type = EXCLUDED.resource_type,
  resource_cost = EXCLUDED.resource_cost,
  cooldown_ms = EXCLUDED.cooldown_ms,
  damage_multiplier = EXCLUDED.damage_multiplier,
  flat_bonus = EXCLUDED.flat_bonus,
  heal_amount = EXCLUDED.heal_amount,
  status_effect = EXCLUDED.status_effect,
  cleanse = EXCLUDED.cleanse,
  is_debug = EXCLUDED.is_debug,
  is_enabled = EXCLUDED.is_enabled,
  flags = EXCLUDED.flags,
  tags = EXCLUDED.tags,
  is_dev_only = EXCLUDED.is_dev_only,
  grant_min_role = EXCLUDED.grant_min_role,
  rank_group_id = EXCLUDED.rank_group_id,
  rank = EXCLUDED.rank,
  learn_requires_trainer = EXCLUDED.learn_requires_trainer,
  updated_at = now();

-- Minor Heal II (cleric)
INSERT INTO public.spells (
  id, name, description, kind, class_id, min_level, school, is_song, song_school,
  resource_type, resource_cost, cooldown_ms,
  damage_multiplier, flat_bonus, heal_amount,
  status_effect, cleanse,
  is_debug, is_enabled, flags, tags, is_dev_only, grant_min_role,
  rank_group_id, rank, learn_requires_trainer
)
SELECT
  'cleric_minor_heal_ii' AS id,
  s.name || ' II' AS name,
  s.description AS description,
  s.kind AS kind,
  s.class_id AS class_id,
  GREATEST(s.min_level, 4) AS min_level,
  s.school AS school,
  s.is_song AS is_song,
  s.song_school AS song_school,
  s.resource_type AS resource_type,
  s.resource_cost AS resource_cost,
  s.cooldown_ms AS cooldown_ms,
  s.damage_multiplier AS damage_multiplier,
  s.flat_bonus AS flat_bonus,
  COALESCE(s.heal_amount, 0) + 20 AS heal_amount,
  s.status_effect AS status_effect,
  s.cleanse AS cleanse,
  s.is_debug AS is_debug,
  s.is_enabled AS is_enabled,
  s.flags AS flags,
  s.tags AS tags,
  s.is_dev_only AS is_dev_only,
  s.grant_min_role AS grant_min_role,
  s.rank_group_id AS rank_group_id,
  2 AS rank,
  TRUE AS learn_requires_trainer
FROM public.spells s
WHERE s.id = 'cleric_minor_heal'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  class_id = EXCLUDED.class_id,
  min_level = EXCLUDED.min_level,
  school = EXCLUDED.school,
  is_song = EXCLUDED.is_song,
  song_school = EXCLUDED.song_school,
  resource_type = EXCLUDED.resource_type,
  resource_cost = EXCLUDED.resource_cost,
  cooldown_ms = EXCLUDED.cooldown_ms,
  damage_multiplier = EXCLUDED.damage_multiplier,
  flat_bonus = EXCLUDED.flat_bonus,
  heal_amount = EXCLUDED.heal_amount,
  status_effect = EXCLUDED.status_effect,
  cleanse = EXCLUDED.cleanse,
  is_debug = EXCLUDED.is_debug,
  is_enabled = EXCLUDED.is_enabled,
  flags = EXCLUDED.flags,
  tags = EXCLUDED.tags,
  is_dev_only = EXCLUDED.is_dev_only,
  grant_min_role = EXCLUDED.grant_min_role,
  rank_group_id = EXCLUDED.rank_group_id,
  rank = EXCLUDED.rank,
  learn_requires_trainer = EXCLUDED.learn_requires_trainer,
  updated_at = now();

-- ----------------------------------------
-- Rank II ability (catalog + unlock row)
-- ----------------------------------------

-- Ensure a catalog row exists even if bootstrap-from-unlocks runs earlier.
INSERT INTO public.abilities (
  id, name, description, kind,
  resource_type, resource_cost, cooldown_ms,
  is_enabled, is_debug, is_dev_only, grant_min_role,
  flags, tags,
  rank_group_id, rank, learn_requires_trainer
)
SELECT
  'power_strike_ii' AS id,
  a.name || ' II' AS name,
  a.description AS description,
  a.kind AS kind,
  a.resource_type AS resource_type,
  a.resource_cost AS resource_cost,
  a.cooldown_ms AS cooldown_ms,
  a.is_enabled AS is_enabled,
  a.is_debug AS is_debug,
  a.is_dev_only AS is_dev_only,
  a.grant_min_role AS grant_min_role,
  a.flags AS flags,
  a.tags AS tags,
  'power_strike' AS rank_group_id,
  2 AS rank,
  TRUE AS learn_requires_trainer
FROM public.abilities a
WHERE a.id = 'power_strike'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  resource_type = EXCLUDED.resource_type,
  resource_cost = EXCLUDED.resource_cost,
  cooldown_ms = EXCLUDED.cooldown_ms,
  is_enabled = EXCLUDED.is_enabled,
  is_debug = EXCLUDED.is_debug,
  is_dev_only = EXCLUDED.is_dev_only,
  grant_min_role = EXCLUDED.grant_min_role,
  flags = EXCLUDED.flags,
  tags = EXCLUDED.tags,
  rank_group_id = EXCLUDED.rank_group_id,
  rank = EXCLUDED.rank,
  learn_requires_trainer = EXCLUDED.learn_requires_trainer,
  updated_at = now();

-- Provide an unlock row so the catalog is discoverable via unlock-driven audits/tools.
-- Keep it non-auto so it doesn't appear "free" on new characters.
INSERT INTO public.ability_unlocks (class_id, ability_id, min_level, auto_grant, is_enabled, notes)
VALUES
  ('warrior', 'power_strike_ii', 4, false, true, 'Dev Rank II test ability (trainer/quest-driven)')
ON CONFLICT (class_id, ability_id) DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ----------------------------------------
-- Point debug quests at Rank II ids
-- ----------------------------------------

DELETE FROM public.quest_rewards
WHERE quest_id IN (
  'debug_q_grant_arcane_bolt',
  'debug_q_grant_mage_fire_bolt',
  'debug_q_grant_cleric_minor_heal',
  'debug_q_grant_power_strike'
)
AND kind IN ('spell_grant','ability_grant');

-- Spell grants (pending; learned via trainer)
INSERT INTO public.quest_rewards (quest_id, kind, amount, item_id, item_qty, title_id, extra_json)
VALUES
  (
    'debug_q_grant_arcane_bolt',
    'spell_grant',
    NULL, NULL, NULL, NULL,
    '{"spellId":"arcane_bolt_ii","source":"quest:debug_q_grant_arcane_bolt"}'::jsonb
  ),
  (
    'debug_q_grant_mage_fire_bolt',
    'spell_grant',
    NULL, NULL, NULL, NULL,
    '{"spellId":"mage_fire_bolt_ii","source":"quest:debug_q_grant_mage_fire_bolt"}'::jsonb
  ),
  (
    'debug_q_grant_cleric_minor_heal',
    'spell_grant',
    NULL, NULL, NULL, NULL,
    '{"spellId":"cleric_minor_heal_ii","source":"quest:debug_q_grant_cleric_minor_heal"}'::jsonb
  );

-- Ability grant (pending; learned via trainer)
INSERT INTO public.quest_rewards (quest_id, kind, amount, item_id, item_qty, title_id, extra_json)
VALUES
  (
    'debug_q_grant_power_strike',
    'ability_grant',
    NULL, NULL, NULL, NULL,
    '{"abilityId":"power_strike_ii","source":"quest:debug_q_grant_power_strike"}'::jsonb
  );

COMMIT;
