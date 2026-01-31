-- worldcore/infra/schema/051_seed_spell_unlocks_reference_kits_l1_10.sql
-- System 5.4: Explicit notes for L1–10 reference kit spell unlock rules.
-- Safe to re-run.
--
-- IMPORTANT:
-- - Do NOT introduce brand-new spell ids here unless you also seed them into public.spells first.
-- - This file should stay aligned with the canonical seeds:
--   - 050_seed_reference_class_kits_L1_10.sql (Archmage + Warlock)
--   - 050_seed_reference_status_effect_spells_v1.sql (Templar support spells)

BEGIN;

INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
VALUES
  -- Archmage
  ('archmage','archmage_arcane_bolt',    1, true, true, 'Ref kit L1–10: starter nuke'),
  ('archmage','archmage_expose_arcana',  3, true, true, 'Ref kit L1–10: damageTakenPct debuff'),
  ('archmage','archmage_mana_shield',    5, true, true, 'Ref kit L1–10: self shield'),
  ('archmage','archmage_ignite',         7, true, true, 'Ref kit L1–10: DOT'),
  ('archmage','archmage_purge_hex',      9, true, true, 'Ref kit L1–10: cleanse'),

  -- Warlock
  ('warlock', 'warlock_shadow_bolt',     1, true, true, 'Ref kit L1–10: starter nuke'),
  ('warlock', 'warlock_siphon_life',     3, true, true, 'Ref kit L1–10: DOT sustain'),
  ('warlock', 'warlock_drain_soul',      5, true, true, 'Ref kit L1–10: focused drain'),
  ('warlock', 'warlock_unholy_brand',    7, true, true, 'Ref kit L1–10: damageDealtPct debuff'),
  ('warlock', 'warlock_demon_skin',      9, true, true, 'Ref kit L1–10: self shield'),


  -- Templar
  ('templar','templar_restorative_prayer', 1, true, true, 'Ref kit L1–10: HoT sustain'),
  ('templar','templar_smite',              3, true, true, 'Ref kit L1–10: starter nuke'),
  ('templar','templar_minor_cleanse',      5, true, true, 'Ref kit L1–10: self cleanse'),
  ('templar','templar_aegis_of_light',     7, true, true, 'Ref kit L1–10: self shield'),
  ('templar','templar_judgment',           9, true, true, 'Ref kit L1–10: damageTakenPct debuff')
ON CONFLICT (class_id, spell_id)
DO UPDATE SET
  min_level  = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes      = EXCLUDED.notes,
  updated_at = now();

COMMIT;
