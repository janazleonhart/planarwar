-- worldcore/infra/schema/049_create_spell_unlocks_table.sql
-- Create spell_unlocks to mirror ability_unlocks and allow flexible unlock policy.

CREATE TABLE IF NOT EXISTS public.spell_unlocks (
  class_id   text        NOT NULL,
  spell_id   text        NOT NULL,
  min_level  int4        NOT NULL DEFAULT 1,
  auto_grant bool        NOT NULL DEFAULT true,
  is_enabled bool        NOT NULL DEFAULT true,
  notes      text        NOT NULL DEFAULT ''::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Primary key (idempotent)
DO $$
BEGIN
  ALTER TABLE public.spell_unlocks
    ADD CONSTRAINT spell_unlocks_pkey PRIMARY KEY (class_id, spell_id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Foreign key to spells (idempotent)
DO $$
BEGIN
  ALTER TABLE public.spell_unlocks
    ADD CONSTRAINT spell_unlocks_spell_id_fkey
    FOREIGN KEY (spell_id) REFERENCES public.spells (id)
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Helpful index for “what unlocks at this level for this class?”
CREATE INDEX IF NOT EXISTS spell_unlocks_min_level_idx
  ON public.spell_unlocks (class_id, min_level);
