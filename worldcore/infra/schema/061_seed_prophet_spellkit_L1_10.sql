-- worldcore/infra/schema/061_seed_prophet_spellkit_L1_10.sql
--
-- Prophet reference kit (L1–10)
-- Shaman-ish elemental/spirit caster hybrid (Wave1).
--
-- Notes:
-- - Uses existing status-effect spine (DOT + shield absorb + attribute buff).
-- - No special CombatEngine control flags required.

DO $$
BEGIN
  -- Remove prior Prophet spell unlocks + spell definitions (idempotent)
  DELETE FROM public.spell_unlocks
  WHERE class_id = 'prophet'
    AND spell_id IN (
      'prophet_lightning_bolt',
      'prophet_flame_shock',
      'prophet_earth_shield',
      'prophet_ancestral_vigor',
      'prophet_healing_wave'
    );

  DELETE FROM public.spells
  WHERE class_id = 'prophet'
    AND id IN (
      'prophet_lightning_bolt',
      'prophet_flame_shock',
      'prophet_earth_shield',
      'prophet_ancestral_vigor',
      'prophet_healing_wave'
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
      'prophet_lightning_bolt',
      'Lightning Bolt',
      'Call a sharp thread of stormlight to strike your foe.',
      'damage_single_npc',
      'prophet',
      1,
      'nature',
      FALSE,
      NULL,
      'mana',
      10,
      2000,
      1.00,
      6,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,prophet,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'prophet_flame_shock',
      'Flame Shock',
      'Sear the target—then let the burn teach patience.',
      'damage_dot_single_npc',
      'prophet',
      3,
      'fire',
      FALSE,
      NULL,
      'mana',
      14,
      12000,
      0.55,
      3,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{fire,prophet,dot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"dot_prophet_flame_shock",
          "name":"Flame Shock",
          "tags":["dot","debuff","fire","prophet","reference_kit"],
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
      'prophet_earth_shield',
      'Earth Shield',
      'Stone answers your call, catching a few hits meant for flesh.',
      'shield_self',
      'prophet',
      5,
      'nature',
      FALSE,
      NULL,
      'mana',
      16,
      18000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,prophet,shield,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"shield_prophet_earth_shield",
          "name":"Earth Shield",
          "tags":["shield","nature","prophet","reference_kit"],
          "maxStacks":1,
          "durationMs":12000,
          "absorb":{
            "amount":32
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'prophet_ancestral_vigor',
      'Ancestral Vigor',
      'Your ancestors steady your stance and harden your spirit.',
      'buff_self',
      'prophet',
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
      '{nature,prophet,buff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"buff_prophet_ancestral_vigor",
          "name":"Ancestral Vigor",
          "tags":["buff","spirit","nature","prophet","reference_kit"],
          "maxStacks":1,
          "durationMs":12000,
          "modifiers":{
            "damageTakenPct":-5,
            "attributes":{"sta":2,"wis":2}
          }
        }'::jsonb
      ),
      NULL
    ),
    (
      'prophet_healing_wave',
      'Healing Wave',
      'A steady surge of restorative power—no theatrics, just results.',
      'heal_self',
      'prophet',
      9,
      'nature',
      FALSE,
      NULL,
      'mana',
      20,
      3500,
      NULL,
      NULL,
      28,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{nature,prophet,heal,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    );

  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('prophet', 'prophet_lightning_bolt', 1, TRUE, TRUE, 'L1 prophet kit (reference)'),
    ('prophet', 'prophet_flame_shock', 3, TRUE, TRUE, 'L3 prophet kit (reference)'),
    ('prophet', 'prophet_earth_shield', 5, TRUE, TRUE, 'L5 prophet kit (reference)'),
    ('prophet', 'prophet_ancestral_vigor', 7, TRUE, TRUE, 'L7 prophet kit (reference)'),
    ('prophet', 'prophet_healing_wave', 9, TRUE, TRUE, 'L9 prophet kit (reference)');

END $$;
