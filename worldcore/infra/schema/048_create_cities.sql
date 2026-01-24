-- worldcore/infra/schema/048_create_cities.sql
-- CityBuilder foundation: account-owned city (ONE city per account, period).
-- - Canonical ownership: cities.account_id -> public.accounts.id (uuid)
-- - Constraint: UNIQUE(account_id)
-- - shard_id stored for where the city lives (planar realms: no multi-city per account)

-- Ensure uuid generator exists (accounts already uses uuid; this keeps cities consistent).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL,
  shard_id    text NOT NULL,
  name        text NOT NULL DEFAULT 'City',
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cities_account_fk
    FOREIGN KEY (account_id)
    REFERENCES public.accounts(id)
    ON DELETE CASCADE,

  CONSTRAINT cities_one_per_account
    UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS cities_shard_idx ON public.cities (shard_id);
