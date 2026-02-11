-- worldcore/infra/schema/067_add_spell_ability_ranks_v0.sql
--
-- Spell + Ability Rank System v0
--
-- Goal:
-- - Represent ranks as separate spell/ability entries (different ids).
-- - Tie ranks together via rank_group_id.
-- - Allow policy: Rank I can be auto-granted, higher ranks can be unlocked by content
--   but learned through trainer flows.
--
-- Notes:
-- - Safe + additive: defaults keep existing content behaving as Rank I.

BEGIN;

-- Spells: add rank metadata.
ALTER TABLE public.spells
  ADD COLUMN IF NOT EXISTS rank_group_id text;

ALTER TABLE public.spells
  ADD COLUMN IF NOT EXISTS rank integer;

ALTER TABLE public.spells
  ADD COLUMN IF NOT EXISTS learn_requires_trainer boolean;

-- Defaults / backfill (idempotent).
UPDATE public.spells
SET
  rank_group_id = COALESCE(NULLIF(rank_group_id, ''), id),
  rank = COALESCE(rank, 1),
  learn_requires_trainer = COALESCE(learn_requires_trainer, false)
WHERE
  rank_group_id IS NULL
  OR rank IS NULL
  OR learn_requires_trainer IS NULL
  OR rank_group_id = '';

-- Tighten constraints (safe after backfill).
ALTER TABLE public.spells
  ALTER COLUMN rank_group_id SET NOT NULL,
  ALTER COLUMN rank_group_id SET DEFAULT ''::text;

ALTER TABLE public.spells
  ALTER COLUMN rank SET NOT NULL,
  ALTER COLUMN rank SET DEFAULT 1;

ALTER TABLE public.spells
  ALTER COLUMN learn_requires_trainer SET NOT NULL,
  ALTER COLUMN learn_requires_trainer SET DEFAULT false;

CREATE INDEX IF NOT EXISTS spells_rank_group_id_idx ON public.spells (rank_group_id);
CREATE INDEX IF NOT EXISTS spells_rank_idx ON public.spells (rank);


-- Abilities: add rank metadata (catalog only; mechanics remain code-defined for now).
ALTER TABLE public.abilities
  ADD COLUMN IF NOT EXISTS rank_group_id text;

ALTER TABLE public.abilities
  ADD COLUMN IF NOT EXISTS rank integer;

ALTER TABLE public.abilities
  ADD COLUMN IF NOT EXISTS learn_requires_trainer boolean;

UPDATE public.abilities
SET
  rank_group_id = COALESCE(NULLIF(rank_group_id, ''), id),
  rank = COALESCE(rank, 1),
  learn_requires_trainer = COALESCE(learn_requires_trainer, false)
WHERE
  rank_group_id IS NULL
  OR rank IS NULL
  OR learn_requires_trainer IS NULL
  OR rank_group_id = '';

ALTER TABLE public.abilities
  ALTER COLUMN rank_group_id SET NOT NULL,
  ALTER COLUMN rank_group_id SET DEFAULT ''::text;

ALTER TABLE public.abilities
  ALTER COLUMN rank SET NOT NULL,
  ALTER COLUMN rank SET DEFAULT 1;

ALTER TABLE public.abilities
  ALTER COLUMN learn_requires_trainer SET NOT NULL,
  ALTER COLUMN learn_requires_trainer SET DEFAULT false;

CREATE INDEX IF NOT EXISTS abilities_rank_group_id_idx ON public.abilities (rank_group_id);
CREATE INDEX IF NOT EXISTS abilities_rank_idx ON public.abilities (rank);

COMMIT;
