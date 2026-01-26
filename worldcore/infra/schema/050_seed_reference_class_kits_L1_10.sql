-- worldcore/infra/schema/050_seed_reference_class_kits_L1_10.sql
-- System 5.4: Seed L1–10 reference spell kits (Archmage + Warlock) and unlock rules.
-- Note: Warlord kit uses abilities (see ability_unlocks). This file seeds spells + spell_unlocks only.

BEGIN;

-- ---------------------------------------------------------------------------
-- Spells: reference kit (L1–10)
-- Schema columns (public.spells):
--   id, name, description, kind, class_id, min_level, school,
--   is_song, song_school, resource_type, resource_cost, cooldown_ms,
--   damage_multiplier, flat_bonus, heal_amount,
--   is_debug, is_enabled, flags (jsonb), tags (text[]),
--   is_dev_only, grant_min_role
-- ---------------------------------------------------------------------------

INSERT INTO public.spells (
  id, name, description, kind, class_id, min_level, school,
  is_song, song_school, resource_type, resource_cost, cooldown_ms,
  damage_multiplier, flat_bonus, heal_amount,
  is_debug, is_enabled, flags, tags,
  is_dev_only, grant_min_role
) VALUES
  -- Archmage
  ('archmage_arcane_bolt', 'Arcane Bolt', 'A simple bolt of arcane energy.', 'damage_single_npc', 'archmage', 1, 'arcane',
    false, NULL, 'mana', 6, 1500,
    1.00, 2, 0,
    false, true, '{}'::jsonb, ARRAY['reference_kit','archmage','caster']::text[],
    false, 'player'),
  ('archmage_expose_arcana', 'Expose Arcana', 'Weaken a target''s resistance to magic.', 'debuff_single_npc', 'archmage', 3, 'arcane',
    false, NULL, 'mana', 8, 9000,
    0.00, 0, 0,
    false, true, '{"damageTakenPct": 0.10}'::jsonb, ARRAY['reference_kit','archmage','debuff']::text[],
    false, 'player'),
  ('archmage_mana_shield', 'Mana Shield', 'Convert mana into a protective barrier.', 'shield_self', 'archmage', 5, 'arcane',
    false, NULL, 'mana', 10, 12000,
    0.00, 0, 0,
    false, true, '{"absorbAmount": 20}'::jsonb, ARRAY['reference_kit','archmage','defense']::text[],
    false, 'player'),
  ('archmage_ignite', 'Ignite', 'Set the target ablaze, dealing damage over time.', 'damage_dot_single_npc', 'archmage', 7, 'fire',
    false, NULL, 'mana', 8, 9000,
    0.00, 0, 0,
    false, true, '{"dotTickMs": 2000, "dotFlatDamage": 4, "dotMaxTicks": 4}'::jsonb, ARRAY['reference_kit','archmage','dot']::text[],
    false, 'player'),
  ('archmage_purge_hex', 'Purge Hex', 'Cleanse harmful magic from an ally.', 'cleanse_single_ally', 'archmage', 9, 'arcane',
    false, NULL, 'mana', 9, 8000,
    0.00, 0, 0,
    false, true, '{"cleanseTags": ["curse","hex"]}'::jsonb, ARRAY['reference_kit','archmage','cleanse']::text[],
    false, 'player'),

  -- Warlock
  ('warlock_shadow_bolt', 'Shadow Bolt', 'Hurl a bolt of shadow at the target.', 'damage_single_npc', 'warlock', 1, 'shadow',
    false, NULL, 'mana', 6, 1500,
    1.00, 2, 0,
    false, true, '{}'::jsonb, ARRAY['reference_kit','warlock','caster']::text[],
    false, 'player'),
  ('warlock_siphon_life', 'Siphon Life', 'Drain vitality over time and heal yourself.', 'damage_dot_single_npc', 'warlock', 3, 'shadow',
    false, NULL, 'mana', 8, 12000,
    0.00, 0, 0,
    false, true, '{"dotTickMs": 2000, "dotFlatDamage": 3, "dotMaxTicks": 5, "selfHealPerTick": 2}'::jsonb, ARRAY['reference_kit','warlock','dot']::text[],
    false, 'player'),
  ('warlock_drain_soul', 'Drain Soul', 'Channel a draining beam to harvest essence.', 'damage_single_npc', 'warlock', 5, 'shadow',
    false, NULL, 'mana', 10, 10000,
    1.10, 1, 0,
    false, true, '{"onKill": {"tag": "soul_fragment", "chance": 0.35}}'::jsonb, ARRAY['reference_kit','warlock','sustain']::text[],
    false, 'player'),
  ('warlock_unholy_brand', 'Unholy Brand', 'Mark a target, amplifying your curses.', 'debuff_single_npc', 'warlock', 7, 'shadow',
    false, NULL, 'mana', 9, 12000,
    0.00, 0, 0,
    false, true, '{"damageDealtPct": 0.08}'::jsonb, ARRAY['reference_kit','warlock','debuff']::text[],
    false, 'player'),
  ('warlock_demon_skin', 'Demon Skin', 'Harden your skin with infernal power.', 'shield_self', 'warlock', 9, 'shadow',
    false, NULL, 'mana', 9, 12000,
    0.00, 0, 0,
    false, true, '{"absorbAmount": 18}'::jsonb, ARRAY['reference_kit','warlock','defense']::text[],
    false, 'player')
ON CONFLICT (id) DO UPDATE SET
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
  grant_min_role = EXCLUDED.grant_min_role;

-- ---------------------------------------------------------------------------
-- Spell unlock rules (autogrants)
-- Columns (public.spell_unlocks):
--   class_id, spell_id, min_level, auto_grant, is_enabled, created_at, updated_at
-- ---------------------------------------------------------------------------

INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled)
SELECT s.class_id, s.id AS spell_id, s.min_level, true AS auto_grant, true AS is_enabled
FROM public.spells s
WHERE s.id IN (
  'archmage_arcane_bolt','archmage_expose_arcana','archmage_mana_shield','archmage_ignite','archmage_purge_hex',
  'warlock_shadow_bolt','warlock_siphon_life','warlock_drain_soul','warlock_unholy_brand','warlock_demon_skin'
)
ON CONFLICT (class_id, spell_id) DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled,
  updated_at = now();

COMMIT;
