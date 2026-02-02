-- worldcore/infra/schema/056_fix_wave1_mapped_spells_class_any.sql
--
-- Fix: Wave 1 class kit mappings reuse proven kit spell_ids, but some runtime/UI queries filter spells
-- by class_id ('any' OR player's class). If these kit spell rows remain class-locked (e.g. 'templar'),
-- cross-class unlocks will not surface.
--
-- This migration updates ONLY the mapped kit spells referenced by Wave 1 to class_id='any'.
-- It does not grant spells by itself; it only makes unlocked spells visible/usable across classes.

BEGIN;

UPDATE public.spells
SET class_id = 'any',
    updated_at = now()
WHERE id IN (
  'archmage_arcane_bolt',
  'archmage_expose_arcana',
  'archmage_ignite',
  'archmage_mana_shield',
  'archmage_purge_hex',
  'templar_aegis_of_light',
  'templar_judgment',
  'templar_minor_cleanse',
  'templar_restorative_prayer',
  'templar_smite',
  'warlock_corruption',
  'warlock_demonic_barrier',
  'warlock_shadow_bolt',
  'warlock_soul_siphon',
  'warlock_weakening_curse'
)
  AND class_id IS DISTINCT FROM 'any';

COMMIT;
