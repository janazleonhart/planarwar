--- worldcore/db/migrations/011_add_account_flags.sql

-- Add JSONB flags to accounts for staff roles.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '{}'::jsonb;
