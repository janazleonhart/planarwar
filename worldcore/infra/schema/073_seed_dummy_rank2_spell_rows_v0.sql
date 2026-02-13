-- worldcore/infra/schema/073_seed_dummy_rank2_spell_rows_v0.sql
--
-- Dummy Rank II spell rows for pipeline testing.
-- These are “lab spells” used by debug quests; they copy fields from Rank I base rows.
-- Marked dev-only so they don't leak into real content.

BEGIN;

-- Arcane Bolt II (base: arcane_bolt)
INSERT INTO public.spells (
  id,
  name,
  description,
  kind,
  class_id,
  min_level,
  school,
  is_song,
  song_school,
  resource_type,
  resource_cost,
  cooldown_ms,
  damage_multiplier,
  flat_bonus,
  heal_amount,
  is_debug,
  is_enabled,
  flags,
  tags,
  is_dev_only,
  grant_min_role,
  rank_group_id,
  rank,
  learn_requires_trainer
)
SELECT
  'arcane_bolt_ii',
  'Arcane Bolt II',
  s.description,
  s.kind,
  s.class_id,
  GREATEST(s.min_level, 4),
  s.school,
  s.is_song,
  s.song_school,
  s.resource_type,
  s.resource_cost,
  s.cooldown_ms,
  s.damage_multiplier,
  s.flat_bonus,
  s.heal_amount,
  s.is_debug,
  s.is_enabled,
  s.flags,
  s.tags,
  TRUE,
  s.grant_min_role,
  'arcane_bolt',
  2,
  TRUE
FROM public.spells s
WHERE s.id = 'arcane_bolt'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  min_level = EXCLUDED.min_level,
  is_dev_only = EXCLUDED.is_dev_only,
  rank_group_id = EXCLUDED.rank_group_id,
  rank = EXCLUDED.rank,
  learn_requires_trainer = EXCLUDED.learn_requires_trainer,
  updated_at = now();

-- Mage Fire Bolt II (base: mage_fire_bolt)
INSERT INTO public.spells (
  id,
  name,
  description,
  kind,
  class_id,
  min_level,
  school,
  is_song,
  song_school,
  resource_type,
  resource_cost,
  cooldown_ms,
  damage_multiplier,
  flat_bonus,
  heal_amount,
  is_debug,
  is_enabled,
  flags,
  tags,
  is_dev_only,
  grant_min_role,
  rank_group_id,
  rank,
  learn_requires_trainer
)
SELECT
  'mage_fire_bolt_ii',
  'Fire Bolt II',
  s.description,
  s.kind,
  s.class_id,
  GREATEST(s.min_level, 4),
  s.school,
  s.is_song,
  s.song_school,
  s.resource_type,
  s.resource_cost,
  s.cooldown_ms,
  s.damage_multiplier,
  s.flat_bonus,
  s.heal_amount,
  s.is_debug,
  s.is_enabled,
  s.flags,
  s.tags,
  TRUE,
  s.grant_min_role,
  'mage_fire_bolt',
  2,
  TRUE
FROM public.spells s
WHERE s.id = 'mage_fire_bolt'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  min_level = EXCLUDED.min_level,
  is_dev_only = EXCLUDED.is_dev_only,
  rank_group_id = EXCLUDED.rank_group_id,
  rank = EXCLUDED.rank,
  learn_requires_trainer = EXCLUDED.learn_requires_trainer,
  updated_at = now();

-- Cleric Minor Heal II (base: cleric_minor_heal)
INSERT INTO public.spells (
  id,
  name,
  description,
  kind,
  class_id,
  min_level,
  school,
  is_song,
  song_school,
  resource_type,
  resource_cost,
  cooldown_ms,
  damage_multiplier,
  flat_bonus,
  heal_amount,
  is_debug,
  is_enabled,
  flags,
  tags,
  is_dev_only,
  grant_min_role,
  rank_group_id,
  rank,
  learn_requires_trainer
)
SELECT
  'cleric_minor_heal_ii',
  'Minor Heal II',
  s.description,
  s.kind,
  s.class_id,
  GREATEST(s.min_level, 4),
  s.school,
  s.is_song,
  s.song_school,
  s.resource_type,
  s.resource_cost,
  s.cooldown_ms,
  s.damage_multiplier,
  s.flat_bonus,
  s.heal_amount,
  s.is_debug,
  s.is_enabled,
  s.flags,
  s.tags,
  TRUE,
  s.grant_min_role,
  'cleric_minor_heal',
  2,
  TRUE
FROM public.spells s
WHERE s.id = 'cleric_minor_heal'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  min_level = EXCLUDED.min_level,
  is_dev_only = EXCLUDED.is_dev_only,
  rank_group_id = EXCLUDED.rank_group_id,
  rank = EXCLUDED.rank,
  learn_requires_trainer = EXCLUDED.learn_requires_trainer,
  updated_at = now();

COMMIT;
