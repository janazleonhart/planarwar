-- worldcore/infra/schema/059_seed_runic_knight_spellkit_L1_10.sql
-- Runic Knight L1–10: bespoke starter kit (5 spells) built around Runic Power.
--
-- Design goals:
-- - Runic Knight’s primary resource is Runic Power (runic_power), generated in combat.
-- - Kit spells are all unique ids (no wave1 mapping to templar/warrior).
-- - Status-effect spells include status_effect JSON so runtime casting is allowed.

DO $$
BEGIN
  -- Remove any wave1 stopgap unlock mappings for Runic Knight.
  DELETE FROM public.ability_unlocks
   WHERE class_id = 'runic_knight'
     AND notes LIKE 'wave1 kit:%';

  DELETE FROM public.spell_unlocks
   WHERE class_id = 'runic_knight'
     AND notes LIKE 'wave1 kit:%';

  -- Idempotent re-seed: remove these spell rows if present (spell_unlocks FK is ON DELETE CASCADE)
  DELETE FROM public.spells
   WHERE id IN (
     'runic_knight_rune_strike',
     'runic_knight_frost_brand',
     'runic_knight_blood_siphon',
     'runic_knight_bone_shield',
     'runic_knight_plague_strike'
   );

  -- Upsert canonical spell rows.
  INSERT INTO public.spells (
    id,
    name,
    description,
    kind,
    class_id,
    min_level,
    school,
    is_song,
    song_school,
    resource_type,
    resource_cost,
    cooldown_ms,
    damage_multiplier,
    flat_bonus,
    heal_amount,
    is_debug,
    is_enabled,
    flags,
    tags,
    is_dev_only,
    grant_min_role,
    status_effect,
    cleanse
  ) VALUES
    (
      'runic_knight_rune_strike',
      'Rune Strike',
      'A runed cleave that carves a little meaning into the target’s existence.',
      'damage_single_npc',
      'runic_knight',
      1,
      'shadow',
      FALSE,
      NULL,
      'runic_power',
      0,
      1500,
      1.00,
      6,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{shadow,runic_knight,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'runic_knight_frost_brand',
      'Frost Brand',
      'A freezing rune that dulls the target’s will to strike true.',
      'debuff_single_npc',
      'runic_knight',
      3,
      'frost',
      FALSE,
      NULL,
      'runic_power',
      10,
      12000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{frost,runic_knight,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_runic_knight_frost_brand",
          "name":"Frost Brand",
          "tags":["debuff","frost","runic_knight","reference_kit"],
          "maxStacks":1,
          "durationMs":8000,
          "modifiers":{
            "damageDealtPct":-8
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'runic_knight_blood_siphon',
      'Blood Siphon',
      'Steal back a sliver of vitality. The rune doesn’t care whose it was originally.',
      'heal_self',
      'runic_knight',
      5,
      'shadow',
      FALSE,
      NULL,
      'runic_power',
      12,
      10000,
      NULL,
      NULL,
      24,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{shadow,runic_knight,heal,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'runic_knight_bone_shield',
      'Bone Shield',
      'A lattice of bone-runes hardens around you, catching the next blows.',
      'shield_self',
      'runic_knight',
      7,
      'shadow',
      FALSE,
      NULL,
      'runic_power',
      18,
      20000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{shadow,runic_knight,shield,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"shield_runic_knight_bone_shield",
          "name":"Bone Shield",
          "tags":["shield","shadow","runic_knight","reference_kit"],
          "maxStacks":1,
          "durationMs":12000,
          "absorb":{
            "amount":35
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'runic_knight_plague_strike',
      'Plague Strike',
      'A cursed wound that festers on a schedule. Your calendar. Their problem.',
      'damage_dot_single_npc',
      'runic_knight',
      9,
      'shadow',
      FALSE,
      NULL,
      'runic_power',
      16,
      12000,
      0.60,
      3,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{shadow,runic_knight,dot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"dot_runic_knight_plague_strike",
          "name":"Plague",
          "tags":["dot","debuff","shadow","runic_knight","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "dot":{
            "tickIntervalMs":2000,
            "spreadDamageAcrossTicks":true
          }
        }'::jsonb
      ),
      NULL
    )
  ON CONFLICT (id) DO UPDATE SET
    name              = EXCLUDED.name,
    description       = EXCLUDED.description,
    kind              = EXCLUDED.kind,
    class_id          = EXCLUDED.class_id,
    min_level         = EXCLUDED.min_level,
    school            = EXCLUDED.school,
    is_song           = EXCLUDED.is_song,
    song_school       = EXCLUDED.song_school,
    resource_type     = EXCLUDED.resource_type,
    resource_cost     = EXCLUDED.resource_cost,
    cooldown_ms       = EXCLUDED.cooldown_ms,
    damage_multiplier = EXCLUDED.damage_multiplier,
    flat_bonus        = EXCLUDED.flat_bonus,
    heal_amount       = EXCLUDED.heal_amount,
    is_debug          = EXCLUDED.is_debug,
    is_enabled        = EXCLUDED.is_enabled,
    flags             = EXCLUDED.flags,
    tags              = EXCLUDED.tags,
    is_dev_only       = EXCLUDED.is_dev_only,
    grant_min_role    = EXCLUDED.grant_min_role,
    status_effect     = EXCLUDED.status_effect,
    cleanse           = EXCLUDED.cleanse,
    updated_at        = now();

  -- Replace unlock schedule for the canonical kit.
  DELETE FROM public.spell_unlocks
   WHERE class_id = 'runic_knight'
     AND spell_id IN (
       'runic_knight_rune_strike',
       'runic_knight_frost_brand',
       'runic_knight_blood_siphon',
       'runic_knight_bone_shield',
       'runic_knight_plague_strike'
     );

  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('runic_knight', 'runic_knight_rune_strike', 1, TRUE, TRUE, 'L1 runic knight kit'),
    ('runic_knight', 'runic_knight_frost_brand', 3, TRUE, TRUE, 'L3 runic knight kit'),
    ('runic_knight', 'runic_knight_blood_siphon', 5, TRUE, TRUE, 'L5 runic knight kit'),
    ('runic_knight', 'runic_knight_bone_shield', 7, TRUE, TRUE, 'L7 runic knight kit'),
    ('runic_knight', 'runic_knight_plague_strike', 9, TRUE, TRUE, 'L9 runic knight kit');
END $$;
