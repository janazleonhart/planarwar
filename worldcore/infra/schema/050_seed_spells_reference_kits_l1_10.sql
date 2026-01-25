-- worldcore/infra/schema/050_seed_spells_reference_kits_l1_10.sql

BEGIN;

-- Reference spell kits for early progression (L1-L10).
-- IMPORTANT: This file matches the actual public.spells schema created in 040_create_spells_table.sql
-- (no target/range/cast_ms columns, spell_aliases uses alias_id).

-- -----------------------------
-- Archmage (caster axis)
-- -----------------------------
INSERT INTO public.spells (
  id, name, description, kind, class_id, min_level,
  school,
  resource_type, resource_cost, cooldown_ms,
  damage_multiplier, flat_bonus, heal_amount,
  is_debug, is_enabled, flags, tags, is_dev_only, grant_min_role
)
VALUES
  (
    'archmage_arcane_missiles',
    'Arcane Missiles',
    'Launches a tight volley of arcane energy at a single target.',
    'damage_single_npc',
    'archmage',
    1,
    'arcane',
    'mana', 12, 1500,
    1.05, 10, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","starter"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','starter'],
    false, 'player'
  ),
  (
    'archmage_frost_shard',
    'Frost Shard',
    'Hurls a shard of ice that bites deep.',
    'damage_single_npc',
    'archmage',
    3,
    'frost',
    'mana', 15, 2000,
    1.12, 12, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","frost"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','frost'],
    false, 'player'
  ),
  (
    'archmage_fireball',
    'Fireball',
    'Condenses heat into a roaring projectile.',
    'damage_single_npc',
    'archmage',
    5,
    'fire',
    'mana', 20, 2500,
    1.25, 16, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","fire"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','fire'],
    false, 'player'
  ),
  (
    'archmage_mana_surge',
    'Mana Surge',
    'A raw arcane spike that overpowers defenses through sheer force.',
    'damage_single_npc',
    'archmage',
    7,
    'arcane',
    'mana', 24, 3000,
    1.35, 20, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","arcane"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','arcane'],
    false, 'player'
  ),
  (
    'archmage_void_lance',
    'Void Lance',
    'A focused lance of cold shadow that rips through flesh.',
    'damage_single_npc',
    'archmage',
    9,
    'shadow',
    'mana', 28, 3200,
    1.42, 24, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","shadow"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','shadow'],
    false, 'player'
  )
ON CONFLICT (id)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  class_id = EXCLUDED.class_id,
  min_level = EXCLUDED.min_level,
  school = EXCLUDED.school,
  resource_type = EXCLUDED.resource_type,
  resource_cost = EXCLUDED.resource_cost,
  cooldown_ms = EXCLUDED.cooldown_ms,
  damage_multiplier = EXCLUDED.damage_multiplier,
  flat_bonus = EXCLUDED.flat_bonus,
  heal_amount = EXCLUDED.heal_amount,
  is_debug = EXCLUDED.is_debug,
  is_enabled = EXCLUDED.is_enabled,
  flags = EXCLUDED.flags,
  tags = EXCLUDED.tags,
  is_dev_only = EXCLUDED.is_dev_only,
  grant_min_role = EXCLUDED.grant_min_role,
  updated_at = now();

-- -----------------------------
-- Warlock (summoner axis)
-- -----------------------------
INSERT INTO public.spells (
  id, name, description, kind, class_id, min_level,
  school,
  resource_type, resource_cost, cooldown_ms,
  damage_multiplier, flat_bonus, heal_amount,
  is_debug, is_enabled, flags, tags, is_dev_only, grant_min_role
)
VALUES
  (
    'warlock_shadow_bolt',
    'Shadow Bolt',
    'A bolt of shadow that chills the soul.',
    'damage_single_npc',
    'warlock',
    1,
    'shadow',
    'mana', 12, 1600,
    1.08, 10, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","shadow"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','shadow'],
    false, 'player'
  ),
  (
    'warlock_hex_bolt',
    'Hex Bolt',
    'A spiteful curse condensed into a projectile.',
    'damage_single_npc',
    'warlock',
    3,
    'shadow',
    'mana', 15, 2000,
    1.15, 12, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","curse"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','curse'],
    false, 'player'
  ),
  (
    'warlock_siphon_vitality',
    'Siphon Vitality',
    'Steal a fragment of life to mend your own wounds.',
    'heal_self',
    'warlock',
    5,
    'shadow',
    'mana', 18, 8000,
    NULL, NULL, 30,
    false, true,
    '{"kit":"ref_l1_10","tags":["heal","self"]}'::jsonb,
    ARRAY['kit:ref_l1_10','heal','self'],
    false, 'player'
  ),
  (
    'warlock_demonfire',
    'Demonfire',
    'A burst of hellfire that scorches a single foe.',
    'damage_single_npc',
    'warlock',
    7,
    'fire',
    'mana', 22, 2800,
    1.30, 18, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","fire"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','fire'],
    false, 'player'
  ),
  (
    'warlock_abyssal_lance',
    'Abyssal Lance',
    'A spear of darkness that punches through armor.',
    'damage_single_npc',
    'warlock',
    9,
    'shadow',
    'mana', 26, 3200,
    1.40, 22, NULL,
    false, true,
    '{"kit":"ref_l1_10","tags":["nuke","shadow"]}'::jsonb,
    ARRAY['kit:ref_l1_10','nuke','shadow'],
    false, 'player'
  )
ON CONFLICT (id)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  class_id = EXCLUDED.class_id,
  min_level = EXCLUDED.min_level,
  school = EXCLUDED.school,
  resource_type = EXCLUDED.resource_type,
  resource_cost = EXCLUDED.resource_cost,
  cooldown_ms = EXCLUDED.cooldown_ms,
  damage_multiplier = EXCLUDED.damage_multiplier,
  flat_bonus = EXCLUDED.flat_bonus,
  heal_amount = EXCLUDED.heal_amount,
  is_debug = EXCLUDED.is_debug,
  is_enabled = EXCLUDED.is_enabled,
  flags = EXCLUDED.flags,
  tags = EXCLUDED.tags,
  is_dev_only = EXCLUDED.is_dev_only,
  grant_min_role = EXCLUDED.grant_min_role,
  updated_at = now();

-- -----------------------------
-- Spell aliases (QoL)
-- -----------------------------
INSERT INTO public.spell_aliases (alias_id, spell_id)
VALUES
  ('am', 'archmage_arcane_missiles'),
  ('arcane_missiles', 'archmage_arcane_missiles'),
  ('frost_shard', 'archmage_frost_shard'),
  ('fireball', 'archmage_fireball'),
  ('mana_surge', 'archmage_mana_surge'),
  ('void_lance', 'archmage_void_lance'),

  ('shadow_bolt', 'warlock_shadow_bolt'),
  ('hex', 'warlock_hex_bolt'),
  ('siphon', 'warlock_siphon_vitality'),
  ('demonfire', 'warlock_demonfire'),
  ('abyssal_lance', 'warlock_abyssal_lance')
ON CONFLICT (alias_id)
DO UPDATE SET
  spell_id = EXCLUDED.spell_id,
  updated_at = now();

COMMIT;
