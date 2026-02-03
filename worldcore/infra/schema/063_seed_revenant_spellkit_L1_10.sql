-- worldcore/infra/schema/063_seed_revenant_spellkit_L1_10.sql
--
-- Revenant reference kit (L1–10)
-- Shadow knight / SK analogue: curses + ward + self-sustain. Uses mana.
--
-- Notes:
-- - Uses existing status-effect spine (dot + shield + debuff).
-- - No pet/minion verbs in Wave1; that comes with the Pet Engine milestone.

DO $$
BEGIN
  -- Remove prior Revenant spell unlocks + spell definitions (idempotent)
  DELETE FROM public.spell_unlocks
  WHERE class_id = 'revenant'
    AND spell_id IN (
      'revenant_shadow_slash',
      'revenant_deathly_miasma',
      'revenant_soul_siphon',
      'revenant_dark_ward',
      'revenant_dread_presence'
    );

  DELETE FROM public.spells
  WHERE class_id = 'revenant'
    AND id IN (
      'revenant_shadow_slash',
      'revenant_deathly_miasma',
      'revenant_soul_siphon',
      'revenant_dark_ward',
      'revenant_dread_presence'
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
      'revenant_shadow_slash',
      'Shadow Slash',
      'A brutal slash laced with shadow. The blade bites twice: steel and dread.',
      'damage_single_npc',
      'revenant',
      1,
      'shadow',
      FALSE,
      NULL,
      'mana',
      10,
      2500,
      1.03,
      7,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{shadow,revenant,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'revenant_deathly_miasma',
      'Deathly Miasma',
      'A choking haze of decay that gnaws at the target over time.',
      'damage_dot_single_npc',
      'revenant',
      3,
      'shadow',
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
      '{shadow,revenant,dot,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"dot_revenant_deathly_miasma",
          "name":"Deathly Miasma",
          "tags":["dot","debuff","shadow","revenant","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "modifiers":{},
          "dot":{ "tickIntervalMs":2000, "spreadDamageAcrossTicks":true }
        }'::jsonb
      ),
      NULL
    ),
    (
      'revenant_soul_siphon',
      'Soul Siphon',
      'Steal a sliver of vitality. It’s not “healing,” it’s reclamation.',
      'heal_self',
      'revenant',
      5,
      'shadow',
      FALSE,
      NULL,
      'mana',
      16,
      6000,
      NULL,
      NULL,
      18,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{shadow,revenant,reference_kit}',
      FALSE,
      'player',
      NULL,
      NULL
    ),
    (
      'revenant_dark_ward',
      'Dark Ward',
      'A veil of shadow wraps around you, swallowing the next few strikes.',
      'shield_self',
      'revenant',
      7,
      'shadow',
      FALSE,
      NULL,
      'mana',
      18,
      18000,
      NULL,
      NULL,
      NULL,
      FALSE,
      TRUE,
      '{}'::jsonb,
      '{shadow,revenant,shield,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"shield_revenant_dark_ward",
          "name":"Dark Ward",
          "tags":["shield","shadow","revenant","reference_kit"],
          "maxStacks":1,
          "durationMs":12000,
          "modifiers":{},
          "absorb":{ "amount":34 }
        }'::jsonb
      ),
      NULL
    ),
    (
      'revenant_dread_presence',
      'Dread Presence',
      'Your presence crushes resolve. The target’s blows lose their conviction.',
      'debuff_single_npc',
      'revenant',
      9,
      'shadow',
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
      '{shadow,revenant,debuff,reference_kit}',
      FALSE,
      'player',
      (
        '{
          "id":"debuff_revenant_dread_presence",
          "name":"Dread Presence",
          "tags":["debuff","fear","shadow","revenant","reference_kit"],
          "maxStacks":1,
          "durationMs":10000,
          "modifiers":{ "damageDealtPct":-12 }
        }'::jsonb
      ),
      NULL
    );

  INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled, notes)
  VALUES
    ('revenant', 'revenant_shadow_slash', 1, TRUE, TRUE, 'L1 revenant kit (reference)'),
    ('revenant', 'revenant_deathly_miasma', 3, TRUE, TRUE, 'L3 revenant kit (reference)'),
    ('revenant', 'revenant_soul_siphon', 5, TRUE, TRUE, 'L5 revenant kit (reference)'),
    ('revenant', 'revenant_dark_ward', 7, TRUE, TRUE, 'L7 revenant kit (reference)'),
    ('revenant', 'revenant_dread_presence', 9, TRUE, TRUE, 'L9 revenant kit (reference)');

END $$;
