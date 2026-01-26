-- worldcore/infra/schema/050_seed_reference_class_kits_L1_10.sql
-- System 5.4: Seed L1–10 reference spell kits (Archmage + Warlock) and explicit unlock rules.
--
-- IMPORTANT:
-- - Requires 049_create_spell_unlocks_table.sql to have created public.spell_unlocks
-- - Assumes 050_add_spell_effect_payloads_v1.sql has added public.spells.status_effect + public.spells.cleanse
--
-- Idempotent: safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- Spells: reference kit (L1–10)
-- ---------------------------------------------------------------------------
INSERT INTO public.spells (
  id, name, description, kind, class_id, min_level, school,
  is_song, song_school,
  resource_type, resource_cost, cooldown_ms,
  damage_multiplier, flat_bonus, heal_amount,
  status_effect, cleanse,
  is_debug, is_enabled,
  flags, tags,
  is_dev_only, grant_min_role
) VALUES
  -- -----------------------------
  -- Archmage (caster axis)
  -- -----------------------------
  (
    'archmage_arcane_bolt',
    'Arcane Bolt',
    'A simple bolt of arcane energy.',
    'damage_single_npc',
    'archmage',
    1,
    'arcane',
    false, NULL,
    'mana', 6, 1500,
    1.00, 2, NULL,
    NULL::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','archmage','caster']::text[],
    false, 'player'
  ),
  (
    'archmage_expose_arcana',
    'Expose Arcana',
    'Weaken a target, making them take more damage.',
    'debuff_single_npc',
    'archmage',
    3,
    'arcane',
    false, NULL,
    'mana', 8, 9000,
    0.00, 0, NULL,
    '{
      "id":"archmage_expose_arcana",
      "durationMs":12000,
      "modifiers":{"damageTakenPct":0.10},
      "tags":["debuff","arcane","ref_l1_10"]
    }'::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','archmage','debuff']::text[],
    false, 'player'
  ),
  (
    'archmage_mana_shield',
    'Mana Shield',
    'Convert mana into a protective barrier.',
    'shield_self',
    'archmage',
    5,
    'arcane',
    false, NULL,
    'mana', 10, 12000,
    0.00, 0, NULL,
    '{
      "id":"archmage_mana_shield",
      "durationMs":12000,
      "modifiers":{},
      "absorb":{"amount":20},
      "tags":["shield","ref_l1_10"]
    }'::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','archmage','defense','shield']::text[],
    false, 'player'
  ),
  (
    'archmage_ignite',
    'Ignite',
    'Set the target ablaze, dealing damage over time.',
    'damage_dot_single_npc',
    'archmage',
    7,
    'fire',
    false, NULL,
    'mana', 8, 9000,
    1.10, 6, NULL,
    '{
      "id":"archmage_ignite",
      "durationMs":8000,
      "modifiers":{},
      "dot":{"tickIntervalMs":2000,"spreadDamageAcrossTicks":true},
      "tags":["dot","fire","ref_l1_10"]
    }'::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','archmage','dot','fire']::text[],
    false, 'player'
  ),
  (
    'archmage_purge_hex',
    'Purge Hex',
    'Cleanse harmful magic from an ally.',
    'cleanse_single_ally',
    'archmage',
    9,
    'arcane',
    false, NULL,
    'mana', 9, 8000,
    0.00, 0, NULL,
    NULL::jsonb,
    '{"tags":["curse","hex"],"maxToRemove":1}'::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','archmage','cleanse']::text[],
    false, 'player'
  ),

  -- -----------------------------
  -- Warlock (curse/sustain axis; summons later)
  -- -----------------------------
  (
    'warlock_shadow_bolt',
    'Shadow Bolt',
    'Hurl a bolt of shadow at the target.',
    'damage_single_npc',
    'warlock',
    1,
    'shadow',
    false, NULL,
    'mana', 6, 1500,
    1.00, 2, NULL,
    NULL::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','warlock','caster']::text[],
    false, 'player'
  ),
  (
    'warlock_siphon_life',
    'Siphon Life',
    'Drain vitality over time.',
    'damage_dot_single_npc',
    'warlock',
    3,
    'shadow',
    false, NULL,
    'mana', 8, 12000,
    1.05, 4, NULL,
    '{
      "id":"warlock_siphon_life",
      "durationMs":10000,
      "modifiers":{},
      "dot":{"tickIntervalMs":2000,"spreadDamageAcrossTicks":true},
      "tags":["dot","shadow","ref_l1_10"]
    }'::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','warlock','dot','shadow']::text[],
    false, 'player'
  ),
  (
    'warlock_drain_soul',
    'Drain Soul',
    'A focused drain that weakens the target.',
    'damage_single_npc',
    'warlock',
    5,
    'shadow',
    false, NULL,
    'mana', 10, 10000,
    1.10, 1, NULL,
    NULL::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','warlock','sustain']::text[],
    false, 'player'
  ),
  (
    'warlock_unholy_brand',
    'Unholy Brand',
    'Mark a target, amplifying your damage.',
    'debuff_single_npc',
    'warlock',
    7,
    'shadow',
    false, NULL,
    'mana', 9, 12000,
    0.00, 0, NULL,
    '{
      "id":"warlock_unholy_brand",
      "durationMs":12000,
      "modifiers":{"damageDealtPct":0.08},
      "tags":["debuff","shadow","ref_l1_10"]
    }'::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','warlock','debuff']::text[],
    false, 'player'
  ),
  (
    'warlock_demon_skin',
    'Demon Skin',
    'Harden your skin with infernal power.',
    'shield_self',
    'warlock',
    9,
    'shadow',
    false, NULL,
    'mana', 9, 12000,
    0.00, 0, NULL,
    '{
      "id":"warlock_demon_skin",
      "durationMs":12000,
      "modifiers":{},
      "absorb":{"amount":18},
      "tags":["shield","ref_l1_10"]
    }'::jsonb,
    NULL::jsonb,
    false, true,
    '{"kit":"ref_l1_10"}'::jsonb,
    ARRAY['reference_kit','ref_l1_10','warlock','defense','shield']::text[],
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
  is_song = EXCLUDED.is_song,
  song_school = EXCLUDED.song_school,
  resource_type = EXCLUDED.resource_type,
  resource_cost = EXCLUDED.resource_cost,
  cooldown_ms = EXCLUDED.cooldown_ms,
  damage_multiplier = EXCLUDED.damage_multiplier,
  flat_bonus = EXCLUDED.flat_bonus,
  heal_amount = EXCLUDED.heal_amount,
  status_effect = EXCLUDED.status_effect,
  cleanse = EXCLUDED.cleanse,
  is_debug = EXCLUDED.is_debug,
  is_enabled = EXCLUDED.is_enabled,
  flags = EXCLUDED.flags,
  tags = EXCLUDED.tags,
  is_dev_only = EXCLUDED.is_dev_only,
  grant_min_role = EXCLUDED.grant_min_role;

-- ---------------------------------------------------------------------------
-- Spell unlock rules (explicit; includes notes)
-- ---------------------------------------------------------------------------
INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
VALUES
  ('archmage','archmage_arcane_bolt',    1, true, true, 'Ref kit L1–10: starter nuke'),
  ('archmage','archmage_expose_arcana',  3, true, true, 'Ref kit L1–10: damageTakenPct debuff'),
  ('archmage','archmage_mana_shield',    5, true, true, 'Ref kit L1–10: self shield'),
  ('archmage','archmage_ignite',         7, true, true, 'Ref kit L1–10: DOT'),
  ('archmage','archmage_purge_hex',      9, true, true, 'Ref kit L1–10: cleanse'),

  ('warlock', 'warlock_shadow_bolt',     1, true, true, 'Ref kit L1–10: starter nuke'),
  ('warlock', 'warlock_siphon_life',     3, true, true, 'Ref kit L1–10: DOT sustain'),
  ('warlock', 'warlock_drain_soul',      5, true, true, 'Ref kit L1–10: focused drain'),
  ('warlock', 'warlock_unholy_brand',    7, true, true, 'Ref kit L1–10: damageDealtPct debuff'),
  ('warlock', 'warlock_demon_skin',      9, true, true, 'Ref kit L1–10: self shield')
ON CONFLICT (class_id, spell_id)
DO UPDATE SET
  min_level  = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  notes      = EXCLUDED.notes,
  updated_at = now();

COMMIT;
