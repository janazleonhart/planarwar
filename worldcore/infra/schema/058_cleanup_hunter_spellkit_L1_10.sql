-- worldcore/infra/schema/058_cleanup_hunter_spellkit_L1_10.sql
-- Hunter L1–10: canonical kit cleanup (removes duplicates/ghost ids).
--
-- Canonical kit ids:
--   L1  hunter_steady_shot
--   L3  hunter_serrated_arrow
--   L5  hunter_hunters_mark
--   L7  hunter_field_dressing
--   L9  hunter_aimed_shot

DO $$
BEGIN
  -- Remove the wave1 stopgap mapping (hunter -> warrior abilities)
  DELETE FROM public.ability_unlocks
   WHERE class_id = 'hunter'
     AND notes = 'wave1 kit: warrior map';

  -- Remove known duplicate/ghost spell ids from unlock schedules.
  DELETE FROM public.spell_unlocks
   WHERE class_id = 'hunter'
     AND spell_id IN (
       'hunter_quick_shot',
       'hunter_serpent_sting',
       'hunter_evasive_roll',
       'hunter_bear_trap',
       'hunter_eagle_eye'
     );

  -- Remove the old spell rows (if present). (spell_unlocks FK is ON DELETE CASCADE)
  DELETE FROM public.spells
   WHERE id IN (
       'hunter_quick_shot',
       'hunter_serpent_sting',
       'hunter_evasive_roll',
       'hunter_bear_trap',
       'hunter_eagle_eye'
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
      'hunter_steady_shot',
      'Steady Shot',
      'A steady, reliable shot—boring in the best possible way.',
      'damage_single_npc',
      'hunter',
      1,
      'nature',
      FALSE,
      NULL,
      'fury',
      8,
      1500,
      1.00,
      6,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hunter,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'hunter_serrated_arrow',
      'Serrated Arrow',
      'A cruel cut that keeps bleeding with every tick.',
      'damage_dot_single_npc',
      'hunter',
      3,
      'nature',
      FALSE,
      NULL,
      'fury',
      8,
      12000,
      0.55,
      3,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hunter,dot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"dot_hunter_serrated",
          "name":"Serrated",
          "tags":["dot","debuff","bleed","nature","hunter","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "dot":{
            "tickIntervalMs":2000,
            "spreadDamageAcrossTicks":true
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'hunter_hunters_mark',
      'Hunter''s Mark',
      'Mark the prey—your attacks find weak points more easily.',
      'debuff_single_npc',
      'hunter',
      5,
      'nature',
      FALSE,
      NULL,
      'fury',
      9,
      12000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hunter,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_hunter_hunters_mark",
          "name":"Hunter\u2019s Mark",
          "tags":["debuff","nature","hunter","reference_kit"],
          "maxStacks":1,
          "durationMs":8000,
          "modifiers":{
            "damageTakenPct":8
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'hunter_field_dressing',
      'Field Dressing',
      'Patch yourself up—quick, pragmatic, and surprisingly effective.',
      'heal_hot_self',
      'hunter',
      7,
      'nature',
      FALSE,
      NULL,
      'fury',
      10,
      20000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hunter,hot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"hot_hunter_field_dressing",
          "name":"Field Dressing",
          "tags":["hot","nature","hunter","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "hot":{
            "tickIntervalMs":2000,
            "perTickHeal":7
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'hunter_aimed_shot',
      'Aimed Shot',
      'Take a heartbeat to line it up—then hit like a truck full of arrows.',
      'damage_single_npc',
      'hunter',
      9,
      'nature',
      FALSE,
      NULL,
      'fury',
      12,
      6000,
      1.20,
      8,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hunter,reference_kit}',
      FALSE,
      'player',
      NULL,
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
   WHERE class_id = 'hunter'
     AND spell_id IN (
       'hunter_steady_shot',
       'hunter_serrated_arrow',
       'hunter_hunters_mark',
       'hunter_field_dressing',
       'hunter_aimed_shot'
     );

  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('hunter', 'hunter_steady_shot', 1, TRUE, TRUE, 'L1 hunter kit (canonical)'),
    ('hunter', 'hunter_serrated_arrow', 3, TRUE, TRUE, 'L3 hunter kit (canonical)'),
    ('hunter', 'hunter_hunters_mark', 5, TRUE, TRUE, 'L5 hunter kit (canonical)'),
    ('hunter', 'hunter_field_dressing', 7, TRUE, TRUE, 'L7 hunter kit (canonical)'),
    ('hunter', 'hunter_aimed_shot', 9, TRUE, TRUE, 'L9 hunter kit (canonical)');
END $$;

-- Optional (ONLY if you want to purge removed ids from existing hunter characters):
 UPDATE characters
 SET spellbook = jsonb_set(
   spellbook,
   '{known}',
   COALESCE(spellbook->'known','{}'::jsonb)
     - 'hunter_quick_shot'
     - 'hunter_serpent_sting'
     - 'hunter_evasive_roll'
     - 'hunter_bear_trap'
     - 'hunter_eagle_eye'
 )
WHERE class_id = 'hunter';
