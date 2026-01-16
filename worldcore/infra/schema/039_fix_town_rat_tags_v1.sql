-- worldcore/infra/schema/039_fix_town_rat_tags_v1.sql
--
-- Fix: ensure Town Rat is tagged as a skinnable creature.
--
-- Why:
-- - Postgres NPC prototypes override DEFAULT_NPC_PROTOTYPES at runtime.
-- - skin_loot seed rules (and fallback skin loot) rely on tags like 'beast'/'critter'.
-- - If 'town_rat' lacks these tags in DB, skinning yields no loot.
--
-- This migration appends 'beast' and 'critter' to town_rat tags if missing.
-- Safe to re-run.

UPDATE npcs
SET tags = (
  SELECT ARRAY(
    SELECT DISTINCT t
    FROM unnest(COALESCE(npcs.tags, ARRAY[]::text[]) || ARRAY['beast','critter']) AS t
    WHERE t IS NOT NULL AND btrim(t) <> ''
  )
)
WHERE id = 'town_rat'
  AND NOT (COALESCE(tags, ARRAY[]::text[]) @> ARRAY['beast','critter']::text[]);
