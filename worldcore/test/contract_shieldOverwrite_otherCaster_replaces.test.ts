// worldcore/test/contract_shieldOverwrite_otherCaster_replaces.test.ts

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

test("[contract] shield overwrite: other-caster same shield id replaces (global LWW)", () => {
  const target = makeChar("c_target", "Target");
  const casterA = "c_caster_A";
  const casterB = "c_caster_B";

  const school: DamageSchool = "arcane";
  const now0 = 3_000_000;

  // Caster A applies a shield with 80 absorb.
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
      appliedById: casterA,
      absorb: { amount: 80 },
    },
    now0,
  );

  // Caster B overwrites with 120 absorb (same id => global LWW).
  const now1 = now0 + 1234;
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
      appliedById: casterB,
      absorb: { amount: 120 },
    },
    now1,
  );

  const effects = getActiveStatusEffects(target, now1 + 1);
  const shields = effects.filter((e) => e.id === "shield_contract_test_basic");
  assert.equal(shields.length, 1, "same shield id should not create multiple instances across casters");

  const shield = shields[0];
  assert.equal(shield.appliedByKind, "character");
  assert.equal(shield.appliedById, casterB, "latest caster should own the active shield instance");
  assert.ok(shield.absorb);
  assert.equal(shield.absorb!.remaining, 120, "overwrite should replace absorb amount (not add/keep old)");

  // Damage should consume the overwritten shield pool only.
  const r = absorbIncomingDamageFromStatusEffects(target, 50, school, now1 + 2);
  assert.equal(r.absorbed, 50);
  assert.equal(r.remainingDamage, 0);

  const after = getActiveStatusEffects(target, now1 + 3).find((e) => e.id === "shield_contract_test_basic");
  assert.ok(after?.absorb);
  assert.equal(after!.absorb!.remaining, 70);
});
