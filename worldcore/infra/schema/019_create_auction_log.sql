--- worldcore/infra/schema/019_create_auction_log.sql

CREATE TABLE IF NOT EXISTS auction_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),

  shard_id        text NOT NULL,
  listing_id      bigint NOT NULL,

  actor_char_id   text,
  actor_char_name text,

  action          text NOT NULL, -- 'create' | 'buy' | 'cancel' | 'expire' | 'claim'
  details         jsonb          -- { itemId, qty, price, total, proceeds, reason, ... }
);

CREATE INDEX IF NOT EXISTS idx_auction_log_listing_at
  ON auction_log (listing_id, at DESC);

CREATE INDEX IF NOT EXISTS idx_auction_log_actor_at
  ON auction_log (actor_char_id, at DESC);
