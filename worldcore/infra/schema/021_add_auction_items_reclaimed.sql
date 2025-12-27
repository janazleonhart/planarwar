--- worldcore/infra/schema/021_add_auction_items_reclaimed.sql

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS items_reclaimed boolean NOT NULL DEFAULT false;
