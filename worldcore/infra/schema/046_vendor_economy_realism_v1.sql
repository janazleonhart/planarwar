-- worldcore/infra/schema/046_vendor_economy_realism_v1.sql
-- Economy Realism v1: vendor stock/restock + pricing config.

CREATE TABLE IF NOT EXISTS vendor_item_economy (
  vendor_item_id INT PRIMARY KEY,
  stock_max INT NOT NULL DEFAULT 50,
  restock_per_hour INT NOT NULL DEFAULT 30,
  price_min_mult NUMERIC(6,3) NOT NULL DEFAULT 0.850,
  price_max_mult NUMERIC(6,3) NOT NULL DEFAULT 1.500
);

CREATE TABLE IF NOT EXISTS vendor_item_state (
  vendor_item_id INT PRIMARY KEY,
  stock INT NOT NULL,
  last_restock_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed economy rows for any existing vendor_items.
INSERT INTO vendor_item_economy (vendor_item_id)
SELECT vi.id
FROM vendor_items vi
ON CONFLICT (vendor_item_id) DO NOTHING;

-- Seed state with full stock.
INSERT INTO vendor_item_state (vendor_item_id, stock, last_restock_ts)
SELECT e.vendor_item_id, e.stock_max, NOW()
FROM vendor_item_economy e
ON CONFLICT (vendor_item_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS vendor_item_state_restock_idx ON vendor_item_state (last_restock_ts);
