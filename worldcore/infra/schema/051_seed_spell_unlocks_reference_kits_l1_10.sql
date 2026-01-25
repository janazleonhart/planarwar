-- worldcore/infra/schema/051_seed_spell_unlocks_reference_kits_l1_10.sql

BEGIN;

-- Reference class spell unlock kits (L1-L10).
-- Optional because 049A_seed_spell_unlocks_from_spells.sql will also seed these
-- from public.spells, but this file provides explicit notes for the kits.

INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
VALUES
  -- Archmage (caster axis)
  ('archmage', 'archmage_arcane_missiles', 1, true, true, 'Ref kit L1–10: starter arcane DPS'),
  ('archmage', 'archmage_frost_shard',     3, true, true, 'Ref kit L1–10: early frost option'),
  ('archmage', 'archmage_fireball',        5, true, true, 'Ref kit L1–10: classic fire nuke'),
  ('archmage', 'archmage_mana_surge',      7, true, true, 'Ref kit L1–10: arcane spike'),
  ('archmage', 'archmage_void_lance',      9, true, true, 'Ref kit L1–10: shadow finisher'),

  -- Warlock (summoner axis; actual summons come later)
  ('warlock',  'warlock_shadow_bolt',      1, true, true, 'Ref kit L1–10: starter shadow DPS'),
  ('warlock',  'warlock_hex_bolt',         3, true, true, 'Ref kit L1–10: curse-flavored nuke'),
  ('warlock',  'warlock_siphon_vitality',  5, true, true, 'Ref kit L1–10: self-sustain'),
  ('warlock',  'warlock_demonfire',        7, true, true, 'Ref kit L1–10: fire axis nuke'),
  ('warlock',  'warlock_abyssal_lance',    9, true, true, 'Ref kit L1–10: shadow spike')
ON CONFLICT (class_id, spell_id)
DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

COMMIT;
