// worldcore/test/contract_absorbedDamageBreaksCC.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffect, getActiveStatusEffects } from "../combat/StatusEffects";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";

import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";
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

function makeEntity(charId: string, hp: number): Entity {
  return {
    id: `ent:${charId}`,
    kind: "player",
    hp,
    maxHp: hp,
    posX: 0,
    posY: 0,
    posZ: 0,
    shardId: "s",
  } as any;
}

test("[contract] absorbed damage still breaks break-on-damage CC (sleep/mez/incap)", () => {
  const now0 = Date.now();
  const school: DamageSchool = "physical";

  const char = makeChar("c1", "Tester");
  const ent = makeEntity(char.id, 100);

  // Apply sleep CC that should break on ANY hit, even if fully absorbed.
  applyStatusEffect(
    char,
    {
      id: "sleep_cc",
      name: "Sleep",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["debuff", "sleep"],
      sourceKind: "spell",
      sourceId: "contract_sleep",
      stackingPolicy: "refresh",
    },
    now0,
  );

  // Shield large enough to fully absorb the hit.
  applyStatusEffect(
    char,
    {
      id: "shield_absorb_50",
      name: "Shield 50",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["shield"],
      sourceKind: "spell",
      sourceId: "contract_shield_50",
      stackingPolicy: "refresh",
      stackingGroupId: "grp_shield_absorb_50",
      absorb: { amount: 50 },
    },
    now0 + 1,
  );

  const r = applySimpleDamageToPlayer(ent, 6, char, school, { ignoreServiceProtection: true } as any);
  assert.equal(r.absorbed, 6);
  assert.equal(r.newHp, 100, "expected fully absorbed hit to deal 0 HP damage");

  const effects = getActiveStatusEffects(char, now0 + 2_000);
  const sleep = effects.find((e: any) => e.id === "sleep_cc" || (Array.isArray(e.tags) && e.tags.includes("sleep")));
  assert.equal(sleep, undefined, "expected sleep to break even when hit was fully absorbed");
});
