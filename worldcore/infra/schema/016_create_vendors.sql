--- worldcore/infra/schema/016_create_vendors.sql

CREATE TABLE IF NOT EXISTS vendors (
  id    text PRIMARY KEY,     -- 'starter_alchemist'
  name  text NOT NULL
  -- later: room_id, npc_id, faction_id, etc.
);

CREATE TABLE IF NOT EXISTS vendor_items (
  id          bigserial PRIMARY KEY,
  vendor_id   text NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  item_id     text NOT NULL,     -- FK to items.id
  price_gold  integer NOT NULL   -- simple gold price for now
  -- later: stock_limit, restock_seconds, required_flags, etc.
);

CREATE INDEX IF NOT EXISTS idx_vendor_items_vendor
  ON vendor_items (vendor_id);
