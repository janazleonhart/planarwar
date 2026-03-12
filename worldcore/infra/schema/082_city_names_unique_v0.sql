-- worldcore/infra/schema/082_city_names_unique_v0.sql
-- Ensure city names are unique case-insensitively before player-facing city creation is enabled.

WITH ranked AS (
  SELECT id,
         name,
         ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY created_at, id) AS rn
  FROM public.cities
)
UPDATE public.cities c
SET name = left(c.name, 18) || '-' || substr(c.id::text, 1, 4),
    updated_at = NOW()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS cities_name_unique_ci
  ON public.cities (lower(name));
