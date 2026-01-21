-- worldcore/infra/schema/044_npc_loot_seed_v0.sql
-- Optional seed rows (used during early item editor testing).
-- Idempotent upsert keyed by (npc_id, idx).

BEGIN;

INSERT INTO public.npc_loot (npc_id, idx, item_id, chance, min_qty, max_qty)
VALUES
  ('ore_vein_small', 0, 'ore_iron_hematite', 1.0, 1, 1),
  ('town_rat', 0, 'rat_tail', 0.7, 1, 2),
  ('town_rat', 1, 'rat_meat_raw', 0.3, 1, 1)
ON CONFLICT (npc_id, idx) DO UPDATE SET
  item_id  = EXCLUDED.item_id,
  chance   = EXCLUDED.chance,
  min_qty  = EXCLUDED.min_qty,
  max_qty  = EXCLUDED.max_qty;

COMMIT;
