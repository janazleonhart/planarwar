-- worldcore/infra/schema/064_seed_outrider_spellkit_L1_10.sql
--
-- Outrider reference kit (L1–10)
-- Ranger-ish agile ranged hybrid.
--
-- Notes:
-- - Complements the ranged verb pipeline (shoot/autofire).
-- - Uses the existing status-effect spine (DOT + debuff + self buff).

DO $$
BEGIN
  -- Remove prior Outrider spell unlocks + spell definitions (idempotent)
  DELETE FROM public.spell_unlocks
  WHERE class_id = 'outrider'
    AND spell_id IN (
      'outrider_quick_shot',
      'outrider_barbed_arrow',
      'outrider_mark_prey',
      'outrider_evasive_roll',
      'outrider_aimed_shot'
    );

  DELETE FROM public.spells
  WHERE class_id = 'outrider'
    AND id IN (
      'outrider_quick_shot',
      'outrider_barbed_arrow',
      'outrider_mark_prey',
      'outrider_evasive_roll',
      'outrider_aimed_shot'
    );

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
      'outrider_quick_shot',
      'Quick Shot',
      'A fast, practical shot. Not glamorous—effective.',
      'damage_single_npc',
      'outrider',
      1,
      'nature',
      FALSE,
      NULL,
      'mana',
      7,
      1500,
      0.95,
      6,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,outrider,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'outrider_barbed_arrow',
      'Barbed Arrow',
      'A barbed head that keeps cutting—bleed them out over time.',
      'damage_dot_single_npc',
      'outrider',
      3,
      'nature',
      FALSE,
      NULL,
      'mana',
      10,
      12000,
      0.50,
      3,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,outrider,dot,bleed,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"dot_outrider_barbed",
          "name":"Barbed",
          "tags":["dot","debuff","bleed","nature","outrider","reference_kit"],
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
      'outrider_mark_prey',
      'Mark Prey',
      'Paint the target with intent—your follow-up hits land harder.',
      'debuff_single_npc',
      'outrider',
      5,
      'nature',
      FALSE,
      NULL,
      'mana',
      9,
      12000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,outrider,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_outrider_mark_prey",
          "name":"Mark Prey",
          "tags":["debuff","nature","outrider","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "modifiers":{"damageTakenPct":7}
        }'::jsonb
      ),
      NULL
    ),
    (
      'outrider_evasive_roll',
      'Evasive Roll',
      'A quick roll and reset—briefly harden yourself against incoming hits.',
      'buff_self',
      'outrider',
      7,
      'nature',
      FALSE,
      NULL,
      'mana',
      10,
      18000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,outrider,buff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"buff_outrider_evasive_roll",
          "name":"Evasive Roll",
          "tags":["buff","nature","outrider","reference_kit"],
          "maxStacks":1,
          "durationMs":6000,
          "modifiers":{"damageTakenPct":-8}
        }'::jsonb
      ),
      NULL
    ),
    (
      'outrider_aimed_shot',
      'Aimed Shot',
      'Take a breath, find the gap, and punish it.',
      'damage_single_npc',
      'outrider',
      9,
      'nature',
      FALSE,
      NULL,
      'mana',
      12,
      6500,
      1.18,
      8,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,outrider,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    );

  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('outrider', 'outrider_quick_shot', 1, TRUE, TRUE, 'L1 outrider kit (reference)'),
    ('outrider', 'outrider_barbed_arrow', 3, TRUE, TRUE, 'L3 outrider kit (reference)'),
    ('outrider', 'outrider_mark_prey', 5, TRUE, TRUE, 'L5 outrider kit (reference)'),
    ('outrider', 'outrider_evasive_roll', 7, TRUE, TRUE, 'L7 outrider kit (reference)'),
    ('outrider', 'outrider_aimed_shot', 9, TRUE, TRUE, 'L9 outrider kit (reference)');

END $$;
