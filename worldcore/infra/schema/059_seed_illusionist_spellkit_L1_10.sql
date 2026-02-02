-- worldcore/infra/schema/059_seed_illusionist_spellkit_L1_10.sql
--
-- Illusionist reference kit (L1–10)
--
-- v0 control note:
-- - "Snare" / "Mesmerize" are modeled as damageDealtPct suppression for now.
-- - Later we'll upgrade to true movement/action gating once the combat loop exposes hooks.

DO $$
BEGIN
  -- Remove prior Illusionist spell unlocks + spell definitions (idempotent)
  DELETE FROM public.spell_unlocks
  WHERE class_id = 'illusionist'
    AND spell_id IN (
      'illusionist_mind_spike',
      'illusionist_snare',
      'illusionist_mesmerize',
      'illusionist_mirror_image',
      'illusionist_phantasmal_burn'
    );

  DELETE FROM public.spells
  WHERE class_id = 'illusionist'
    AND id IN (
      'illusionist_mind_spike',
      'illusionist_snare',
      'illusionist_mesmerize',
      'illusionist_mirror_image',
      'illusionist_phantasmal_burn'
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
      'illusionist_mind_spike',
      'Mind Spike',
      'A sharp thought, thrown like a dagger. Pain is just information with better marketing.',
      'damage_single_npc',
      'illusionist',
      1,
      'arcane',
      FALSE,
      NULL,
      'mana',
      9,
      2500,
      1.02,
      7,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{arcane,illusionist,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'illusionist_snare',
      'Snare',
      'Warp the target''s sense of distance—every motion feels heavier than it should.',
      'debuff_single_npc',
      'illusionist',
      3,
      'arcane',
      FALSE,
      NULL,
      'mana',
      12,
      12000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{arcane,illusionist,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_illusionist_snare",
          "name":"Snare",
          "tags":["debuff","snare","arcane","illusionist","reference_kit"],
          "maxStacks":1,
          "durationMs":8000,
          "modifiers":{ "damageDealtPct":-10 }
        }'::jsonb
      ),
      NULL
    ),
    (
      'illusionist_mesmerize',
      'Mesmerize',
      'A velvet command that hushes the will. The body obeys. The mind watches.',
      'debuff_single_npc',
      'illusionist',
      5,
      'arcane',
      FALSE,
      NULL,
      'mana',
      14,
      20000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{arcane,illusionist,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_illusionist_mesmerize",
          "name":"Mesmerize",
          "tags":["debuff","mez","arcane","illusionist","reference_kit"],
          "maxStacks":1,
          "durationMs":6000,
          "modifiers":{ "damageDealtPct":-100 }
        }'::jsonb
      ),
      NULL
    ),
    (
      'illusionist_mirror_image',
      'Mirror Image',
      'You split your silhouette into lies. Enemies swing at the wrong truth.',
      'buff_self',
      'illusionist',
      7,
      'arcane',
      FALSE,
      NULL,
      'mana',
      16,
      20000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{arcane,illusionist,buff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"buff_illusionist_mirror_image",
          "name":"Mirror Image",
          "tags":["buff","illusion","arcane","illusionist","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "modifiers":{
            "damageTakenPct":-8,
            "attributes":{ "agi":2, "int":2 }
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'illusionist_phantasmal_burn',
      'Phantasmal Burn',
      'The target believes they are on fire. The body, ever gullible, complies.',
      'damage_dot_single_npc',
      'illusionist',
      9,
      'arcane',
      FALSE,
      NULL,
      'mana',
      18,
      12000,
      0.55,
      3,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{arcane,illusionist,dot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"dot_illusionist_phantasmal_burn",
          "name":"Phantasmal Burn",
          "tags":["dot","debuff","illusion","arcane","illusionist","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "dot":{
            "tickIntervalMs":2000,
            "spreadDamageAcrossTicks":true
          }
        }'::jsonb
      ),
      NULL
    );

  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('illusionist', 'illusionist_mind_spike', 1, TRUE, TRUE, 'L1 illusionist kit (reference)'),
    ('illusionist', 'illusionist_snare', 3, TRUE, TRUE, 'L3 illusionist kit (reference)'),
    ('illusionist', 'illusionist_mesmerize', 5, TRUE, TRUE, 'L5 illusionist kit (reference)'),
    ('illusionist', 'illusionist_mirror_image', 7, TRUE, TRUE, 'L7 illusionist kit (reference)'),
    ('illusionist', 'illusionist_phantasmal_burn', 9, TRUE, TRUE, 'L9 illusionist kit (reference)');
END $$;
