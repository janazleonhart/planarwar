-- worldcore/infra/schema/042A_seed_ability_unlocks_mvp.sql

BEGIN;

-- MVP: seed current code-defined warrior abilities as auto-grants.
-- If you later decide to make these trainable:
--   - set auto_grant=false and have trainers or rewards call learnAbilityWithRules.

INSERT INTO public.ability_unlocks (class_id, ability_id, min_level, auto_grant, is_enabled, notes)
VALUES
  ('warrior', 'power_strike', 1, true, true, 'MVP auto-grant'),
  ('warrior', 'savage_strike', 3, true, true, 'MVP auto-grant'),
  ('warrior', 'guarded_strike', 5, true, true, 'MVP auto-grant')
ON CONFLICT (class_id, ability_id) DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

COMMIT;
