-- worldcore/infra/schema/060_seed_ascetic_spellkit_L1_10.sql
--
-- Ascetic reference kit (L1–10)
--
-- Chi v1 note:
-- - Chi is a first-class power resource (max normalized to 100 like Fury/Mana/Runic Power).
-- - Builder semantics live in worldcore/combat/CastingGates.ts (ascetic_jab grants Chi on success).

DO $$
BEGIN
  -- Remove prior Ascetic spell unlocks + spell definitions (idempotent)
  DELETE FROM public.spell_unlocks
  WHERE class_id = 'ascetic'
    AND spell_id IN (
      'ascetic_jab',
      'ascetic_tiger_palm',
      'ascetic_crippling_strike',
      'ascetic_flying_kick',
      'ascetic_inner_focus'
    );

  DELETE FROM public.spells
  WHERE class_id = 'ascetic'
    AND id IN (
      'ascetic_jab',
      'ascetic_tiger_palm',
      'ascetic_crippling_strike',
      'ascetic_flying_kick',
      'ascetic_inner_focus'
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
      'ascetic_jab',
      'Jab',
      'A fast, disciplined strike. Builds Chi.',
      'damage_single_npc',
      'ascetic',
      1,
      'physical',
      FALSE,
      NULL,
      'chi',
      0,
      2000,
      0.95,
      6,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{martial,ascetic,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'ascetic_tiger_palm',
      'Tiger Palm',
      'Channel Chi into a focused palm strike.',
      'damage_single_npc',
      'ascetic',
      3,
      'physical',
      FALSE,
      NULL,
      'chi',
      12,
      2500,
      1.05,
      7,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{martial,ascetic,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'ascetic_crippling_strike',
      'Crippling Strike',
      'A precise hit to tendons and balance. Slows the target''s offense (v0).',
      'debuff_single_npc',
      'ascetic',
      5,
      'physical',
      FALSE,
      NULL,
      'chi',
      10,
      12000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{martial,ascetic,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_ascetic_crippling_strike",
          "name":"Crippling Strike",
          "tags":["debuff","martial","ascetic","reference_kit"],
          "maxStacks":1,
          "durationMs":8000,
          "modifiers":{ "damageDealtPct":-10 }
        }'::jsonb
      ),
      NULL
    ),
    (
      'ascetic_flying_kick',
      'Flying Kick',
      'A leap and a kick delivered like punctuation. The sentence ends here.',
      'damage_single_npc',
      'ascetic',
      7,
      'physical',
      FALSE,
      NULL,
      'chi',
      18,
      6000,
      1.18,
      10,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{martial,ascetic,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'ascetic_inner_focus',
      'Inner Focus',
      'Breath slows. Sight sharpens. Your next moments are yours to command.',
      'buff_self',
      'ascetic',
      9,
      'physical',
      FALSE,
      NULL,
      'chi',
      16,
      20000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{martial,ascetic,buff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"buff_ascetic_inner_focus",
          "name":"Inner Focus",
          "tags":["buff","martial","ascetic","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "modifiers":{
            "damageTakenPct":-8,
            "attributes":{ "agi":2, "sta":2 }
          }
        }'::jsonb
      ),
      NULL
    );

  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('ascetic', 'ascetic_jab', 1, TRUE, TRUE, 'L1 ascetic kit (reference)'),
    ('ascetic', 'ascetic_tiger_palm', 3, TRUE, TRUE, 'L3 ascetic kit (reference)'),
    ('ascetic', 'ascetic_crippling_strike', 5, TRUE, TRUE, 'L5 ascetic kit (reference)'),
    ('ascetic', 'ascetic_flying_kick', 7, TRUE, TRUE, 'L7 ascetic kit (reference)'),
    ('ascetic', 'ascetic_inner_focus', 9, TRUE, TRUE, 'L9 ascetic kit (reference)');
END $$;
