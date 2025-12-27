--- worldcore/infra/schema/012_add_item_grant_flags.sql

ALTER TABLE items
  ADD COLUMN is_dev_only boolean NOT NULL DEFAULT false,
  ADD COLUMN grant_min_role text NOT NULL DEFAULT 'player';
  
-- Optional: simple check constraint
ALTER TABLE items
  ADD CONSTRAINT items_grant_min_role_valid
  CHECK (grant_min_role IN ('player', 'guide', 'gm', 'dev', 'owner'));
