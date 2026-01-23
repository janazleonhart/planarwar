-- worldcore/infra/schema/047_vendor_economy_realism_v1_1.sql
-- Economy Realism v1.1: restock cadence fields.

ALTER TABLE vendor_item_economy
  ADD COLUMN IF NOT EXISTS restock_every_sec INT NOT NULL DEFAULT 0;

ALTER TABLE vendor_item_economy
  ADD COLUMN IF NOT EXISTS restock_amount INT NOT NULL DEFAULT 0;

UPDATE vendor_item_economy
SET
  restock_every_sec = CASE
    WHEN COALESCE(restock_per_hour, 0) > 0 THEN 3600
    ELSE 0
  END,
  restock_amount = CASE
    WHEN COALESCE(restock_per_hour, 0) > 0 THEN GREATEST(0, restock_per_hour)
    ELSE 0
  END
WHERE
  (restock_every_sec = 0 AND restock_amount = 0)
  AND COALESCE(restock_per_hour, 0) > 0;
