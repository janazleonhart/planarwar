-- worldcore/infra/schema/036_seed_skin_loot_v1.sql
--
-- Minimal starter skinning profiles.
-- This keeps v1 functional while content expands.

-- Broad default: beasts/critter-style mobs drop starter hide scraps.
INSERT INTO skin_loot (npc_tag, item_id, chance, min_qty, max_qty, priority)
SELECT v.npc_tag, v.item_id, v.chance, v.min_qty, v.max_qty, v.priority
FROM (VALUES
  ('beast',   'hide_scraps', 1.0::REAL, 1, 2, 100),
  ('critter', 'hide_scraps', 1.0::REAL, 1, 2, 110)
) AS v(npc_tag, item_id, chance, min_qty, max_qty, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM skin_loot s
  WHERE s.npc_tag = v.npc_tag AND s.item_id = v.item_id
);
