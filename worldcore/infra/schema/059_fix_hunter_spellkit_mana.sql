-- worldcore/infra/schema/059_fix_hunter_spellkit_mana.sql
-- Align Hunter starter kit spells to mana (not fury).
--
-- Motivation:
-- - Hunter primaryResource is mana (spell-based kit).
-- - Keeps Hunter consistent with classic mana-based pacing.
-- - Prevents kit drift between DB and SpellTypes.ts.

DO $$
BEGIN
  UPDATE public.spells
     SET resource_type = 'mana'
   WHERE id IN (
     'hunter_quick_shot',
     'hunter_serpent_sting',
     'hunter_hunters_mark',
     'hunter_evasive_roll',
     'hunter_aimed_shot'
   );
END $$;
