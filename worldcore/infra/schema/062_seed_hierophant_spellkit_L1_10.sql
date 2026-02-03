-- worldcore/infra/schema/062_seed_hierophant_spellkit_L1_10.sql
--
-- Hierophant reference kit (L1–10)
-- Nature priest / druid-flavored healer/caster.
--
-- Notes:
-- - Uses existing status-effect spine (HOT + DOT + buff + debuff).
-- - No new CombatEngine control flags required.

DO $$
BEGIN
  -- Remove prior Hierophant spell unlocks + spell definitions (idempotent)
  DELETE FROM public.spell_unlocks
  WHERE class_id = 'hierophant'
    AND spell_id IN (
      'hierophant_thorn_bolt',
      'hierophant_entangling_vines',
      'hierophant_rejuvenation',
      'hierophant_barkskin',
      'hierophant_sunfire'
    );

  DELETE FROM public.spells
  WHERE class_id = 'hierophant'
    AND id IN (
      'hierophant_thorn_bolt',
      'hierophant_entangling_vines',
      'hierophant_rejuvenation',
      'hierophant_barkskin',
      'hierophant_sunfire'
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
      'hierophant_thorn_bolt',
      'Thorn Bolt',
      'A barbed lash of living thorns. Nature is polite, until it isn’t.',
      'damage_single_npc',
      'hierophant',
      1,
      'nature',
      FALSE,
      NULL,
      'mana',
      10,
      2500,
      0.98,
      7,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hierophant,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'hierophant_entangling_vines',
      'Entangling Vines',
      'Vines coil around the target, choking momentum and confidence. (v0 snare semantics)',
      'debuff_single_npc',
      'hierophant',
      3,
      'nature',
      FALSE,
      NULL,
      'mana',
      14,
      14000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hierophant,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_hierophant_entangling_vines",
          "name":"Entangling Vines",
          "tags":["debuff","snare","nature","hierophant","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "modifiers":{ "damageDealtPct":-12 }
        }'::jsonb
      ),
      NULL
    ),
    (
      'hierophant_rejuvenation',
      'Rejuvenation',
      'A steady pulse of green life. No drama—just repair.',
      'heal_hot_self',
      'hierophant',
      5,
      'nature',
      FALSE,
      NULL,
      'mana',
      16,
      12000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hierophant,hot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"hot_hierophant_rejuvenation",
          "name":"Rejuvenation",
          "tags":["hot","nature","hierophant","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "modifiers":{},
          "hot":{ "tickIntervalMs":2000, "perTickHeal":9 }
        }'::jsonb
      ),
      NULL
    ),
    (
      'hierophant_barkskin',
      'Barkskin',
      'Your skin hardens like bark. Bruises become background noise.',
      'buff_self',
      'hierophant',
      7,
      'nature',
      FALSE,
      NULL,
      'mana',
      18,
      20000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,hierophant,buff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"buff_hierophant_barkskin",
          "name":"Barkskin",
          "tags":["buff","nature","hierophant","reference_kit"],
          "maxStacks":1,
          "durationMs":12000,
          "modifiers":{ "damageTakenPct":-8 }
        }'::jsonb
      ),
      NULL
    ),
    (
      'hierophant_sunfire',
      'Sunfire',
      'A searing kiss of sunlight that keeps burning after the moment passes.',
      'damage_dot_single_npc',
      'hierophant',
      9,
      'fire',
      FALSE,
      NULL,
      'mana',
      18,
      14000,
      0.55,
      3,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{fire,hierophant,dot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"dot_hierophant_sunfire",
          "name":"Sunfire",
          "tags":["dot","debuff","fire","hierophant","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "modifiers":{},
          "dot":{ "tickIntervalMs":2000, "spreadDamageAcrossTicks":true }
        }'::jsonb
      ),
      NULL
    );

  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('hierophant', 'hierophant_thorn_bolt', 1, TRUE, TRUE, 'L1 hierophant kit (reference)'),
    ('hierophant', 'hierophant_entangling_vines', 3, TRUE, TRUE, 'L3 hierophant kit (reference)'),
    ('hierophant', 'hierophant_rejuvenation', 5, TRUE, TRUE, 'L5 hierophant kit (reference)'),
    ('hierophant', 'hierophant_barkskin', 7, TRUE, TRUE, 'L7 hierophant kit (reference)'),
    ('hierophant', 'hierophant_sunfire', 9, TRUE, TRUE, 'L9 hierophant kit (reference)');

END $$;
