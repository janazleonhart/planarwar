-- worldcore/infra/schema/038_seed_skin_loot_town_rat_v1.sql
--
-- Hotfix seed: make sure starter Town Rat can be skinned even if its NPC proto tags
-- don't include 'beast'/'critter' yet.
--
-- Rationale:
-- - SkinLootService resolves in this order:
--     1) npc_proto_id rows (exact match)
--     2) npc_tag rows (e.g. 'beast', 'critter')
-- - Your seed 036_* only provides tag rows, so if town_rat isn't tagged as beast/critter,
--   skinning yields nothing.
--
-- This adds an explicit proto profile for town_rat.

INSERT INTO skin_loot (npc_proto_id, npc_tag, item_id, chance, min_qty, max_qty, priority)
SELECT v.npc_proto_id, v.npc_tag, v.item_id, v.chance, v.min_qty, v.max_qty, v.priority
FROM (VALUES
  ('town_rat', NULL, 'hide_scraps', 1.0::REAL, 1, 2, 90)
) AS v(npc_proto_id, npc_tag, item_id, chance, min_qty, max_qty, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM skin_loot s
  WHERE s.npc_proto_id = v.npc_proto_id AND s.item_id = v.item_id
);
