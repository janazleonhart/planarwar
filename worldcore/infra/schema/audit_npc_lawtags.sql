-- worldcore/infra/schema/audit_npc_lawtags.sql
-- Planar War / worldcore
-- NPC Law Tag Audit
--
-- Goal:
--   Catch conflicting or suspicious law-related tags in the `npcs` table.
--
-- Assumptions:
--   - `npcs.tags` is `text[]` (see infra/schema/024_npcs.sql)
--   - Law tags introduced by Option B:
--       * law_protected  -> forces protected status (guards care)
--       * law_exempt     -> forces NOT protected (guards ignore)
--
-- Notes:
--   - If both tags exist, code should treat `law_exempt` as the winner.
--   - Keep legacy tags (civilian/protected/protected_town/etc.) for convenience,
--     but prefer explicit `law_*` tags for quest-driven exceptions.

\echo '--- [1] NPCs with both law_protected and law_exempt (should be fixed)'
SELECT id, name, tags
FROM npcs
WHERE 'law_protected' = ANY(tags)
  AND 'law_exempt' = ANY(tags)
ORDER BY id;

\echo ''
\echo '--- [2] NPCs marked law_exempt but still carrying legacy protected tags (cleanup recommended)'
SELECT id, name, tags
FROM npcs
WHERE 'law_exempt' = ANY(tags)
  AND tags && ARRAY[
    'protected',
    'protected_town',
    'civilian',
    'vendor',
    'questgiver'
  ]
ORDER BY id;

\echo ''
\echo '--- [3] Critters that still carry town protection tags (often accidental)'
SELECT id, name, tags
FROM npcs
WHERE tags && ARRAY['critter']
  AND tags && ARRAY['protected_town']
ORDER BY id;

\echo ''
\echo '--- [4] Quick check for the classic newbie quest pitfall: town_rat protected'
SELECT id, name, tags
FROM npcs
WHERE id = 'town_rat'
  AND tags && ARRAY['protected', 'protected_town', 'civilian', 'law_protected']
ORDER BY id;

-- ---------------------------------------------------------------------------
-- Optional fix snippets (COMMENTED OUT on purpose)
-- ---------------------------------------------------------------------------
--
-- -- Remove accidental legacy protection from town_rat
-- -- UPDATE npcs
-- -- SET tags = array_remove(array_remove(tags, 'protected'), 'protected_town')
-- -- WHERE id = 'town_rat';
--
-- -- Or force-exempt it (keeps old tags but ensures guards ignore it)
-- -- UPDATE npcs
-- -- SET tags = CASE
-- --   WHEN 'law_exempt' = ANY(tags) THEN tags
-- --   ELSE array_append(tags, 'law_exempt')
-- -- END
-- -- WHERE id = 'town_rat';

\echo ''
\echo '--- [5] Training dummies missing law_exempt (should always be exempt)'
SELECT id, name, tags
FROM npcs
WHERE id IN ('training_dummy', 'training_dummy_big')
  AND NOT ('law_exempt' = ANY(tags))
ORDER BY id;

\echo ''
\echo '--- [6] Protected civilians missing law_protected (recommended to be explicit)'
SELECT id, name, tags
FROM npcs
WHERE tags && ARRAY['civilian', 'protected_town']
  AND NOT ('law_protected' = ANY(tags))
ORDER BY id;
