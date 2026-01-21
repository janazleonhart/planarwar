-- worldcore/infra/schema/040_create_spells_table.sql

BEGIN;

-- Spell / Song definitions (authoritative catalog)
-- Notes:
-- - Mirrors the existing schema conventions (text ids, jsonb flags, grant_min_role check).
-- - This is definitions only; character spell knowledge can remain in characters.spellbook (jsonb) for now.
-- - If/when you migrate knowledge to a join table later, this catalog stays the same.

CREATE TABLE public.spells (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    kind text NOT NULL,
    class_id text NOT NULL,
    min_level integer DEFAULT 1 NOT NULL,
    school text,
    is_song boolean DEFAULT false NOT NULL,
    song_school text,
    resource_type text,
    resource_cost integer DEFAULT 0 NOT NULL,
    cooldown_ms integer DEFAULT 0 NOT NULL,
    damage_multiplier double precision,
    flat_bonus integer,
    heal_amount integer,
    is_debug boolean DEFAULT false NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_dev_only boolean DEFAULT false NOT NULL,
    grant_min_role text DEFAULT 'player'::text NOT NULL,
    CONSTRAINT spells_grant_min_role_valid CHECK ((grant_min_role = ANY (ARRAY['player'::text, 'guide'::text, 'gm'::text, 'dev'::text, 'owner'::text]))),
    CONSTRAINT spells_min_level_check CHECK ((min_level >= 1)),
    CONSTRAINT spells_resource_cost_check CHECK ((resource_cost >= 0)),
    CONSTRAINT spells_cooldown_ms_check CHECK ((cooldown_ms >= 0)),
    CONSTRAINT spells_pkey PRIMARY KEY (id)
);

CREATE INDEX spells_class_id_idx ON public.spells (class_id);
CREATE INDEX spells_is_song_idx ON public.spells (is_song);
CREATE INDEX spells_min_level_idx ON public.spells (min_level);
CREATE INDEX spells_is_enabled_idx ON public.spells (is_enabled);

-- Alias ids -> canonical spell id (prevents "ghost id" drift across tests/content)
CREATE TABLE public.spell_aliases (
    alias_id text NOT NULL,
    spell_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT spell_aliases_pkey PRIMARY KEY (alias_id),
    CONSTRAINT spell_aliases_spell_id_fkey FOREIGN KEY (spell_id) REFERENCES public.spells(id) ON DELETE CASCADE
);

CREATE INDEX spell_aliases_spell_id_idx ON public.spell_aliases (spell_id);

COMMIT;
