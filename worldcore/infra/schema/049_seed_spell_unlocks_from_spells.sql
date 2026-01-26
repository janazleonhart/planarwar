-- worldcore/infra/schema/049A_seed_spell_unlocks_from_spells.sql
-- Seed spell_unlocks from spells table (MVP). Safe to re-run.

INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
SELECT
  s.class_id,
  s.id AS spell_id,
  s.min_level,
  true AS auto_grant,
  s.is_enabled,
  'seeded_from_spells_table' AS notes
FROM public.spells s
WHERE
  s.is_enabled = true
  AND s.is_debug = false
  AND s.is_dev_only = false
  AND s.grant_min_role = 'player'
ON CONFLICT (class_id, spell_id)
DO UPDATE SET
  min_level  = EXCLUDED.min_level,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();
