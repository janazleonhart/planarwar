--- worldcore/infra/schema/020_add_auction_expires_at.sql

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill existing rows: 3 days after created_at by default
UPDATE auctions
SET expires_at = created_at + interval '3 days'
WHERE expires_at IS NULL;