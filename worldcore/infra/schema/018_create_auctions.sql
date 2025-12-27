--- worldcore/infra/schema/018_create_auctions.sql

CREATE TABLE IF NOT EXISTS auctions (
  id                bigserial PRIMARY KEY,
  shard_id          text NOT NULL,

  seller_char_id    text NOT NULL,
  seller_char_name  text NOT NULL,

  item_id           text NOT NULL,
  qty               integer NOT NULL CHECK (qty > 0),
  unit_price_gold   integer NOT NULL CHECK (unit_price_gold > 0),
  total_price_gold  integer NOT NULL CHECK (total_price_gold > 0),

  status            text NOT NULL DEFAULT 'active', -- active|sold|cancelled|expired
  created_at        timestamptz NOT NULL DEFAULT now(),

  buyer_char_id     text,
  buyer_char_name   text,
  sold_at           timestamptz,

  proceeds_gold     integer,
  proceeds_claimed  boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_auctions_active_shard
  ON auctions (shard_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auctions_seller
  ON auctions (seller_char_id, status);
