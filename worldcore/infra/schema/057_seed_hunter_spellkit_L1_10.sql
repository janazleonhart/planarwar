-- worldcore/infra/schema/057_seed_hunter_spellkit_L1_10.sql
-- Hunter L1–10: bespoke starter kit (5 spells).
--
-- Why bespoke?
-- - Avoids cloning the warrior placeholder kit.
-- - Ensures Hunter has real spell ids for reference kit + contract tests.
-- - Status-effect spells must include status_effect JSON or the runtime will refuse to cast.

DO $$
BEGIN
  -- Remove the wave1 stopgap mapping (hunter -> warrior abilities)
  DELETE FROM public.ability_unlocks
   WHERE class_id = 'hunter'
     AND notes = 'wave1 kit: warrior map';

  -- Idempotent re-seed
  DELETE FROM public.spell_unlocks
   WHERE class_id = 'hunter'
     AND spell_id IN (
       'hunter_quick_shot',
       'hunter_serpent_sting',
       'hunter_hunters_mark',
       'hunter_evasive_roll',
       'hunter_aimed_shot'
     );

  DELETE FROM public.spells
   WHERE id IN (
     'hunter_quick_shot',
     'hunter_serpent_sting',
     'hunter_hunters_mark',
     'hunter_evasive_roll',
     'hunter_aimed_shot'
   );

  -- Insert spell rows.
  -- Column list is explicit to stay resilient as schema evolves.
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
      'hunter_quick_shot',
      'Quick Shot',
      'A fast shot that keeps pressure on the target.',
      'damage_single_npc',
      'hunter',
      1,
      'nature',
      FALSE,
      NULL,
      'fury',
      6,
      1500,
      1.00,
      4,
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
      'hunter_serpent_sting',
      'Serpent Sting',
      'A venomous sting that bites again and again.',
      'damage_dot_single_npc',
      'hunter',
      3,
      'nature',
      FALSE,
      NULL,
      'fury',
      8,
      12000,
      0.60,
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
          "id":"dot_hunter_serpent_sting",
          "name":"Serpent Sting",
          "tags":["dot","debuff","poison","nature","hunter","reference_kit"],
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
      'hunter_evasive_roll',
      'Evasive Roll',
      'A quick roll that makes the next hits glance off more easily.',
      'buff_self',
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
      '{nature,hunter,buff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"buff_hunter_evasive_roll",
          "name":"Evasive Roll",
          "tags":["buff","nature","hunter","reference_kit"],
          "maxStacks":1,
          "durationMs":6000,
          "modifiers":{
            "damageTakenPct":-10
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'hunter_aimed_shot',
      'Aimed Shot',
      'Take a heartbeat to line it up\u2014then hit like a truck full of arrows.',
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
    );

  -- Unlock schedule (autogrant)
  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('hunter', 'hunter_quick_shot', 1, TRUE, TRUE, 'L1 hunter kit'),
    ('hunter', 'hunter_serpent_sting', 3, TRUE, TRUE, 'L3 hunter kit'),
    ('hunter', 'hunter_hunters_mark', 5, TRUE, TRUE, 'L5 hunter kit'),
    ('hunter', 'hunter_evasive_roll', 7, TRUE, TRUE, 'L7 hunter kit'),
    ('hunter', 'hunter_aimed_shot', 9, TRUE, TRUE, 'L9 hunter kit');
END $$;
