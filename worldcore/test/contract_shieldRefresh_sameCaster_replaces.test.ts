// worldcore/test/contract_shieldRefresh_sameCaster_replaces.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyStatusEffect,
  getActiveStatusEffects,
  absorbIncomingDamageFromStatusEffects,
} from "../combat/StatusEffects";

import type { CharacterState } from "../characters/CharacterTypes";
import type { DamageSchool } from "../combat/CombatEngine";

function makeChar(id: string, name: string): CharacterState {
  // Minimal stub: StatusEffects only needs (char as any).progression.statusEffects.
  return {
    id,
    userId: "u",
    shardId: "s",
    name,
    classId: "archmage",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: { str: 1, agi: 1, int: 1, sta: 1, wis: 1, cha: 1 },
    inventory: {} as any,
    equipment: {} as any,
    spellbook: {} as any,
    abilities: {} as any,
    progression: { statusEffects: { active: {} } } as any,
    stateVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as any;
}

test("[contract] shield refresh: same-caster recast replaces remaining absorb (no stacking)", () => {
  const target = makeChar("c_target", "Target");
  const casterId = "c_caster";

  const now0 = 2_000_000;
  const school: DamageSchool = "arcane";

  // Apply initial shield for 100 absorb.
  applyStatusEffect(
    target,
    {
      id: "shield_contract_test_basic",
      name: "Contract Shield",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["shield"],
      sourceKind: "spell",
      sourceId: "contract_shield_spell",
      stackingPolicy: "refresh",
      appliedByKind: "character",
      appliedById: casterId,
      absorb: { amount: 100 },
    },
    now0,
  );

  // Take 60 damage => 60 absorbed, 40 remaining.
  const r1 = absorbIncomingDamageFromStatusEffects(target, 60, school, now0 + 1);
  assert.equal(r1.absorbed, 60);
  assert.equal(r1.remainingDamage, 0);

  let effects = getActiveStatusEffects(target, now0 + 2);
  const e1 = effects.find((e) => e.id === "shield_contract_test_basic");
  assert.ok(e1?.absorb, "expected absorb payload on shield");
  assert.equal(e1!.absorb!.remaining, 40);

  // Recast by SAME caster: replace remaining with fresh 100 (no stacking/add).
  const nowRecast = now0 + 5_000;
  applyStatusEffect(
    target,
    {
      id: "shield_contract_test_basic",
      name: "Contract Shield",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["shield"],
      sourceKind: "spell",
      sourceId: "contract_shield_spell",
      stackingPolicy: "refresh",
      appliedByKind: "character",
      appliedById: casterId,
      absorb: { amount: 100 },
    },
    nowRecast,
  );

  effects = getActiveStatusEffects(target, nowRecast + 1);
  const shieldInstances = effects.filter((e) => e.id === "shield_contract_test_basic");
  assert.equal(shieldInstances.length, 1, "shield should not create a second instance on recast");

  const e2 = shieldInstances[0];
  assert.ok(e2.absorb, "expected absorb payload on refreshed shield");
  assert.equal(e2.absorb!.remaining, 100, "recast should replace remaining absorb (not stack/add)");

  const r2 = absorbIncomingDamageFromStatusEffects(target, 60, school, nowRecast + 2);
  assert.equal(r2.absorbed, 60);
  assert.equal(r2.remainingDamage, 0);

  effects = getActiveStatusEffects(target, nowRecast + 3);
  const e3 = effects.find((e) => e.id === "shield_contract_test_basic");
  assert.ok(e3?.absorb);
  assert.equal(e3!.absorb!.remaining, 40);
});
