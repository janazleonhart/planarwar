--- worldcore/infra/schema/create_trade_log.sql

CREATE TABLE IF NOT EXISTS trade_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),

  a_char_id       text NOT NULL,
  a_char_name     text NOT NULL,
  b_char_id       text NOT NULL,
  b_char_name     text NOT NULL,

  a_gold_before   integer NOT NULL,
  a_gold_after    integer NOT NULL,
  b_gold_before   integer NOT NULL,
  b_gold_after    integer NOT NULL,

  a_items_given   jsonb NOT NULL,
  a_items_received jsonb NOT NULL,
  b_items_given   jsonb NOT NULL,
  b_items_received jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_log_chars_at
  ON trade_log (a_char_id, b_char_id, at DESC);
