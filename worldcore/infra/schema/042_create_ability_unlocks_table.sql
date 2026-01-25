-- worldcore/infra/schema/042_create_ability_unlocks_table.sql

BEGIN;

-- Ability unlock rules (who gets which ability and when).
-- Abilities themselves are still code-defined (worldcore/abilities/AbilityTypes.ts).
-- This table allows DB-driven tuning and "trainable vs auto-grant" behavior.
--
-- Notes:
-- - class_id = "any" applies to all classes (use cautiously).
-- - auto_grant = true means the ability is considered known automatically at/above min_level.
-- - auto_grant = false means the ability is learnable (requires explicit learning/persistence).
-- - is_enabled toggles a rule without deleting it.

CREATE TABLE IF NOT EXISTS public.ability_unlocks (
    class_id text NOT NULL,
    ability_id text NOT NULL,
    min_level integer DEFAULT 1 NOT NULL,
    auto_grant boolean DEFAULT true NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    PRIMARY KEY (class_id, ability_id)
);

CREATE INDEX IF NOT EXISTS ability_unlocks_min_level_idx
    ON public.ability_unlocks (class_id, min_level);

COMMIT;
