-- worldcore/infra/schema/056_seed_crusader_spellkit_L1_10.sql
-- Crusader L1–10: bespoke starter kit (5 spells).
--
-- Why bespoke?
-- - We avoid cloning other classes' spells, so future balancing & flavor edits don't create cleanup debt.
-- - Status-effect spells must include status_effect JSON or the runtime will refuse to cast.

DO $$
BEGIN
  -- Idempotent re-seed
  DELETE FROM public.spell_unlocks
   WHERE class_id = 'crusader'
     AND spell_id IN (
       'crusader_righteous_strike',
       'crusader_bleeding_wound',
       'crusader_minor_mend',
       'crusader_sun_guard',
       'crusader_judgment'
     );

  DELETE FROM public.spells
   WHERE id IN (
     'crusader_righteous_strike',
     'crusader_bleeding_wound',
     'crusader_minor_mend',
     'crusader_sun_guard',
     'crusader_judgment'
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
      'crusader_righteous_strike',
      'Righteous Strike',
      'A disciplined blow that punishes the unworthy.',
      'damage_single_npc',
      'crusader',
      1,
      'holy',
      FALSE,
      NULL,
      'mana',
      6,
      1500,
      1.00,
      4,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{holy,crusader,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'crusader_bleeding_wound',
      'Bleeding Wound',
      'You carve a painful gash that bleeds for a short time.',
      'damage_dot_single_npc',
      'crusader',
      3,
      'holy',
      FALSE,
      NULL,
      'mana',
      8,
      12000,
      0.60,
      3,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{holy,crusader,dot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"dot_crusader_bleeding_wound",
          "name":"Bleeding Wound",
          "tags":["dot","debuff","bleed","holy","crusader","reference_kit"],
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
      'crusader_minor_mend',
      'Minor Mend',
      'A modest prayer that knits wounds (best used before you fall over).',
      'heal_self',
      'crusader',
      5,
      'holy',
      FALSE,
      NULL,
      'mana',
      8,
      8000,
      NULL,
      NULL,
      18,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{holy,crusader,heal,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'crusader_sun_guard',
      'Sun Guard',
      'A radiant ward that absorbs the next blows.',
      'shield_self',
      'crusader',
      7,
      'holy',
      FALSE,
      NULL,
      'mana',
      10,
      20000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{holy,crusader,shield,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"shield_crusader_sun_guard",
          "name":"Sun Guard",
          "tags":["shield","buff","holy","crusader","reference_kit"],
          "maxStacks":1,
          "durationMs":12000,
          "absorb":{
            "amount":25
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'crusader_judgment',
      'Judgment',
      'Mark the foe—your next efforts land harder.',
      'debuff_single_npc',
      'crusader',
      9,
      'holy',
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
      '{holy,crusader,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_crusader_judgment",
          "name":"Judgment",
          "tags":["debuff","holy","crusader","reference_kit"],
          "maxStacks":1,
          "durationMs":8000,
          "modifiers":{
            "damageTakenPct":10
          }
        }'::jsonb
      ),
      NULL
    );

  -- Unlock schedule (autogrant)
  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('crusader', 'crusader_righteous_strike', 1, TRUE, TRUE, 'L1 crusader kit'),
    ('crusader', 'crusader_bleeding_wound', 3, TRUE, TRUE, 'L3 crusader kit'),
    ('crusader', 'crusader_minor_mend', 5, TRUE, TRUE, 'L5 crusader kit'),
    ('crusader', 'crusader_sun_guard', 7, TRUE, TRUE, 'L7 crusader kit'),
    ('crusader', 'crusader_judgment', 9, TRUE, TRUE, 'L9 crusader kit');
END $$;
