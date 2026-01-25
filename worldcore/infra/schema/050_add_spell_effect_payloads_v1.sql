-- worldcore/infra/schema/050_add_spell_effect_payloads_v1.sql
-- System 5.3: DB-driven status effects (HoT / Shield / DoT / Buff / Debuff) and cleanse payloads.
-- Adds JSONB payload columns to public.spells (safe, additive).

ALTER TABLE public.spells
  ADD COLUMN IF NOT EXISTS status_effect JSONB;

ALTER TABLE public.spells
  ADD COLUMN IF NOT EXISTS cleanse JSONB;

-- Useful for future admin tooling / filtering (optional but cheap).
CREATE INDEX IF NOT EXISTS spells_status_effect_gin_idx
  ON public.spells
  USING gin (status_effect);

CREATE INDEX IF NOT EXISTS spells_cleanse_gin_idx
  ON public.spells
  USING gin (cleanse);
