-- worldcore/infra/schema/050A_seed_reference_status_effect_spells_v1.sql
-- System 5.3: seed a tiny reference set of status-effect spells (L1–10 kits)
-- - Archmage (caster): Arcane Barrier (shield)
-- - Templar (support): Restorative Prayer (HoT) + Minor Cleanse (cleanse)
-- - Warlock (summoner/curse): Curse of Frailty (debuff) + Shadow Rot (DoT)

-- NOTE: We UPSERT into spells, then ensure matching spell_unlocks rows exist too.
-- This makes it safe to run even if you already inserted these IDs manually.

WITH upserted AS (
  INSERT INTO public.spells (
    id, name, description,
    kind, class_id, min_level,
    school,
    resource_type, resource_cost, cooldown_ms,
    flat_bonus, heal_amount,
    is_debug, is_enabled,
    status_effect, cleanse
  ) VALUES
    (
      'archmage_arcane_barrier',
      'Arcane Barrier',
      'Conjure a short-lived barrier that absorbs damage.',
      'shield_self', 'archmage', 3,
      'arcane',
      'mana', 8, 15000,
      0, NULL,
      false, true,
      jsonb_build_object(
        'id','arcane_barrier',
        'durationMs',12000,
        'maxStacks',1,
        'tags',jsonb_build_array('buff','shield','arcane'),
        'absorb',jsonb_build_object('maxAbsorb',25)
      ),
      NULL
    ),
    (
      'templar_restorative_prayer',
      'Restorative Prayer',
      'A gentle prayer that restores health over time.',
      'heal_hot_self', 'templar', 3,
      'holy',
      'mana', 6, 12000,
      0, 20,
      false, true,
      jsonb_build_object(
        'id','restorative_prayer_hot',
        'durationMs',10000,
        'maxStacks',1,
        'tags',jsonb_build_array('buff','hot','holy'),
        'hot',jsonb_build_object('tickIntervalMs',2000,'spreadHealingAcrossTicks',true)
      ),
      NULL
    ),
    (
      'templar_minor_cleanse',
      'Minor Cleanse',
      'Remove one harmful effect from yourself.',
      'cleanse_self', 'templar', 5,
      'holy',
      'mana', 8, 15000,
      0, NULL,
      false, true,
      NULL,
      jsonb_build_object('tags',jsonb_build_array('debuff','dot'),'maxToRemove',1)
    ),
    (
      'warlock_curse_of_frailty',
      'Curse of Frailty',
      'A weakening curse that makes the target take more damage.',
      'debuff_single_npc', 'warlock', 3,
      'shadow',
      'mana', 6, 12000,
      0, NULL,
      false, true,
      jsonb_build_object(
        'id','curse_of_frailty',
        'durationMs',12000,
        'maxStacks',1,
        'tags',jsonb_build_array('debuff','curse','shadow'),
        'modifiers',jsonb_build_object('damageTakenPct',0.15)
      ),
      NULL
    ),
    (
      'warlock_shadow_rot',
      'Shadow Rot',
      'Rot the target with shadow damage over time.',
      'damage_dot_single_npc', 'warlock', 5,
      'shadow',
      'mana', 8, 15000,
      18, NULL,
      false, true,
      jsonb_build_object(
        'id','shadow_rot',
        'durationMs',12000,
        'maxStacks',1,
        'tags',jsonb_build_array('debuff','dot','shadow'),
        'dot',jsonb_build_object('tickIntervalMs',2000,'spreadDamageAcrossTicks',true)
      ),
      NULL
    )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    kind = EXCLUDED.kind,
    class_id = EXCLUDED.class_id,
    min_level = EXCLUDED.min_level,
    school = EXCLUDED.school,
    resource_type = EXCLUDED.resource_type,
    resource_cost = EXCLUDED.resource_cost,
    cooldown_ms = EXCLUDED.cooldown_ms,
    flat_bonus = EXCLUDED.flat_bonus,
    heal_amount = EXCLUDED.heal_amount,
    is_debug = EXCLUDED.is_debug,
    is_enabled = EXCLUDED.is_enabled,
    status_effect = EXCLUDED.status_effect,
    cleanse = EXCLUDED.cleanse
  RETURNING id, class_id, min_level
)
INSERT INTO public.spell_unlocks (class_id, spell_id, min_level, auto_grant, is_enabled)
SELECT class_id, id, min_level, true, true
FROM upserted
ON CONFLICT (class_id, spell_id) DO UPDATE SET
  min_level = EXCLUDED.min_level,
  auto_grant = EXCLUDED.auto_grant,
  is_enabled = EXCLUDED.is_enabled;
