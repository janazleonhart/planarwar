-- worldcore/infra/schema/042_seed_abilities_from_unlocks.sql

BEGIN;

-- Bootstrap seed: create ability catalog rows for any ability_id currently referenced
-- by ability_unlocks.
--
-- We compute a reasonable display name from the id (initcap + underscores -> spaces).
-- Description stays empty until you fill it (or a future export tool seeds richer data
-- from worldcore/abilities/AbilityTypes.ts).

INSERT INTO public.abilities (id, name, description, kind, is_enabled)
SELECT DISTINCT
  au.ability_id AS id,
  initcap(replace(au.ability_id, '_', ' ')) AS name,
  ''::text AS description,
  ''::text AS kind,
  true AS is_enabled
FROM public.ability_unlocks au
WHERE au.ability_id IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = now();

COMMIT;
