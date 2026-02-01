-- worldcore/infra/schema/055_seed_wave1_class_kit_mappings_L1_10.sql
-- Wave 1: fast "coverage kits" by mapping empty classes to existing proven kits.
-- Goal: every selectable class feels playable to level 10 WITHOUT inventing new spell/ability mechanics yet.
--
-- Philosophy:
-- - These are bootstrap kits. Bespoke class kits can later supersede them.
-- - We prefer idempotent UPSERTs so you can re-run seeds safely.
-- - We DO NOT touch Adventurer here (special anti-datamine rules).

BEGIN;

-- ===== Spells: map support-ish classes -> templar kit =====
INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
VALUES
  ('crusader', 'templar_restorative_prayer', 1, true, true, 'wave1 kit: templar map'),
  ('crusader', 'templar_smite', 3, true, true, 'wave1 kit: templar map'),
  ('crusader', 'templar_minor_cleanse', 5, true, true, 'wave1 kit: templar map'),
  ('crusader', 'templar_aegis_of_light', 7, true, true, 'wave1 kit: templar map'),
  ('crusader', 'templar_judgment', 9, true, true, 'wave1 kit: templar map'),
  ('hierophant', 'templar_restorative_prayer', 1, true, true, 'wave1 kit: templar map'),
  ('hierophant', 'templar_smite', 3, true, true, 'wave1 kit: templar map'),
  ('hierophant', 'templar_minor_cleanse', 5, true, true, 'wave1 kit: templar map'),
  ('hierophant', 'templar_aegis_of_light', 7, true, true, 'wave1 kit: templar map'),
  ('hierophant', 'templar_judgment', 9, true, true, 'wave1 kit: templar map'),
  ('ascetic', 'templar_restorative_prayer', 1, true, true, 'wave1 kit: templar map'),
  ('ascetic', 'templar_smite', 3, true, true, 'wave1 kit: templar map'),
  ('ascetic', 'templar_minor_cleanse', 5, true, true, 'wave1 kit: templar map'),
  ('ascetic', 'templar_aegis_of_light', 7, true, true, 'wave1 kit: templar map'),
  ('ascetic', 'templar_judgment', 9, true, true, 'wave1 kit: templar map'),
  ('prophet', 'templar_restorative_prayer', 1, true, true, 'wave1 kit: templar map'),
  ('prophet', 'templar_smite', 3, true, true, 'wave1 kit: templar map'),
  ('prophet', 'templar_minor_cleanse', 5, true, true, 'wave1 kit: templar map'),
  ('prophet', 'templar_aegis_of_light', 7, true, true, 'wave1 kit: templar map'),
  ('prophet', 'templar_judgment', 9, true, true, 'wave1 kit: templar map')
ON CONFLICT (class_id, spell_id) DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ===== Spells: map caster-ish classes -> archmage kit =====
INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
VALUES
  ('illusionist', 'archmage_arcane_bolt', 1, true, true, 'wave1 kit: archmage map'),
  ('illusionist', 'archmage_expose_arcana', 3, true, true, 'wave1 kit: archmage map'),
  ('illusionist', 'archmage_mana_shield', 5, true, true, 'wave1 kit: archmage map'),
  ('illusionist', 'archmage_ignite', 7, true, true, 'wave1 kit: archmage map'),
  ('illusionist', 'archmage_purge_hex', 9, true, true, 'wave1 kit: archmage map'),
  ('conjuror', 'archmage_arcane_bolt', 1, true, true, 'wave1 kit: archmage map'),
  ('conjuror', 'archmage_expose_arcana', 3, true, true, 'wave1 kit: archmage map'),
  ('conjuror', 'archmage_mana_shield', 5, true, true, 'wave1 kit: archmage map'),
  ('conjuror', 'archmage_ignite', 7, true, true, 'wave1 kit: archmage map'),
  ('conjuror', 'archmage_purge_hex', 9, true, true, 'wave1 kit: archmage map'),
  ('primalist', 'archmage_arcane_bolt', 1, true, true, 'wave1 kit: archmage map'),
  ('primalist', 'archmage_expose_arcana', 3, true, true, 'wave1 kit: archmage map'),
  ('primalist', 'archmage_mana_shield', 5, true, true, 'wave1 kit: archmage map'),
  ('primalist', 'archmage_ignite', 7, true, true, 'wave1 kit: archmage map'),
  ('primalist', 'archmage_purge_hex', 9, true, true, 'wave1 kit: archmage map')
ON CONFLICT (class_id, spell_id) DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ===== Spells: map dark-ish classes -> warlock kit =====
INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
VALUES
  ('revenant', 'warlock_shadow_bolt', 1, true, true, 'wave1 kit: warlock map'),
  ('revenant', 'warlock_weakening_curse', 3, true, true, 'wave1 kit: warlock map'),
  ('revenant', 'warlock_corruption', 5, true, true, 'wave1 kit: warlock map'),
  ('revenant', 'warlock_demonic_barrier', 7, true, true, 'wave1 kit: warlock map'),
  ('revenant', 'warlock_soul_siphon', 9, true, true, 'wave1 kit: warlock map'),
  ('defiler', 'warlock_shadow_bolt', 1, true, true, 'wave1 kit: warlock map'),
  ('defiler', 'warlock_weakening_curse', 3, true, true, 'wave1 kit: warlock map'),
  ('defiler', 'warlock_corruption', 5, true, true, 'wave1 kit: warlock map'),
  ('defiler', 'warlock_demonic_barrier', 7, true, true, 'wave1 kit: warlock map'),
  ('defiler', 'warlock_soul_siphon', 9, true, true, 'wave1 kit: warlock map')
ON CONFLICT (class_id, spell_id) DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

-- ===== Abilities: map martial-ish classes -> warrior kit =====
INSERT INTO public.ability_unlocks (class_id, ability_id, min_level, auto_grant, is_enabled, notes)
VALUES
  ('cutthroat', 'power_strike', 1, true, true, 'wave1 kit: warrior map'),
  ('cutthroat', 'savage_strike', 3, true, true, 'wave1 kit: warrior map'),
  ('cutthroat', 'guarded_strike', 5, true, true, 'wave1 kit: warrior map'),
  ('ravager', 'power_strike', 1, true, true, 'wave1 kit: warrior map'),
  ('ravager', 'savage_strike', 3, true, true, 'wave1 kit: warrior map'),
  ('ravager', 'guarded_strike', 5, true, true, 'wave1 kit: warrior map'),
  ('outrider', 'power_strike', 1, true, true, 'wave1 kit: warrior map'),
  ('outrider', 'savage_strike', 3, true, true, 'wave1 kit: warrior map'),
  ('outrider', 'guarded_strike', 5, true, true, 'wave1 kit: warrior map'),
  ('hunter', 'power_strike', 1, true, true, 'wave1 kit: warrior map'),
  ('hunter', 'savage_strike', 3, true, true, 'wave1 kit: warrior map'),
  ('hunter', 'guarded_strike', 5, true, true, 'wave1 kit: warrior map'),
  ('runic_knight', 'power_strike', 1, true, true, 'wave1 kit: warrior map'),
  ('runic_knight', 'savage_strike', 3, true, true, 'wave1 kit: warrior map'),
  ('runic_knight', 'guarded_strike', 5, true, true, 'wave1 kit: warrior map')
ON CONFLICT (class_id, ability_id) DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

COMMIT;
