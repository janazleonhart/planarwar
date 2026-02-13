-- worldcore/infra/schema/075_seed_npc_town_services_v0.sql
-- Seed baseline town service NPCs (bank/mail/auction).
--
-- Rationale:
--  - serviceGates expects proximity to service anchors (service_bank/service_mail/service_auction).
--  - TownBaselinePlanner can optionally seed these anchors as NPC spawns.
--
-- Idempotent: safe to run multiple times.

INSERT INTO npcs (id, name, level, max_hp, dmg_min, dmg_max, model, tags, xp_reward)
VALUES
  (
    'town_banker',
    'Town Banker',
    1,
    140,
    0,
    0,
    'human_commoner',
    ARRAY['bank','service_bank','protected_service','non_hostile','protected_town','law_protected'],
    0
  ),
  (
    'town_mail_clerk',
    'Town Mail Clerk',
    1,
    120,
    0,
    0,
    'human_commoner',
    ARRAY['mail','service_mail','protected_service','non_hostile','protected_town','law_protected'],
    0
  ),
  (
    'town_auctioneer',
    'Town Auctioneer',
    1,
    150,
    0,
    0,
    'human_commoner',
    ARRAY['auction','service_auction','protected_service','non_hostile','protected_town','law_protected'],
    0
  )
ON CONFLICT (id) DO UPDATE
SET
  name      = EXCLUDED.name,
  level     = EXCLUDED.level,
  max_hp    = EXCLUDED.max_hp,
  dmg_min   = EXCLUDED.dmg_min,
  dmg_max   = EXCLUDED.dmg_max,
  model     = EXCLUDED.model,
  tags      = EXCLUDED.tags,
  xp_reward = EXCLUDED.xp_reward;
