-- worldcore/infra/schema/072_fix_dummy_rank2_power_strike_ii_seed_v0.sql
--
-- Ensure Rank II dummy ability id exists in public.abilities.

BEGIN;

INSERT INTO public.abilities (
  id,
  name,
  description,
  kind,
  is_enabled,
  rank_group_id,
  rank,
  learn_requires_trainer
) VALUES (
  'power_strike_ii',
  'Power Strike II',
  ''::text,
  ''::text,
  true,
  'power_strike',
  2,
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  rank_group_id = EXCLUDED.rank_group_id,
  rank = EXCLUDED.rank,
  learn_requires_trainer = EXCLUDED.learn_requires_trainer,
  updated_at = now();

COMMIT;
