-- worldcore/infra/schema/042_create_abilities_table.sql

BEGIN;

-- Abilities catalog (mirrors the spells table concept).
--
-- ability_unlocks answers: "who gets what and when"
-- abilities answers: "what is this ability" (name/description/cooldown/cost/flags)
--
-- Mechanics are still code-defined in worldcore/abilities/AbilityTypes.ts for now.
-- This table is for metadata/UI and future balance knobs.

CREATE TABLE IF NOT EXISTS public.abilities (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,

    -- Optional classification (kept similar to spells.kind)
    kind text DEFAULT ''::text NOT NULL,

    -- Optional knobs for UI and (future) balance
    resource_type text,
    resource_cost integer,
    cooldown_ms integer,

    is_enabled boolean DEFAULT true NOT NULL,
    is_debug boolean DEFAULT false NOT NULL,
    is_dev_only boolean DEFAULT false NOT NULL,
    grant_min_role text DEFAULT 'player'::text NOT NULL,

    flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text DEFAULT ''::text NOT NULL,

    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS abilities_enabled_idx ON public.abilities (is_enabled);
CREATE INDEX IF NOT EXISTS abilities_kind_idx ON public.abilities (kind);

COMMIT;
