// worldcore/test/contract_absorbOrdering_afterDamageTakenMods.test.ts
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

test("[contract] absorb ordering: incoming damageTaken modifiers apply before shields absorb", () => {
  const now0 = Date.now();
  const school: DamageSchool = "physical";

  const char = makeChar("c1", "Tester");
  const ent = makeEntity(char.id, 100);

  // Incoming damage taken +100% (double damage).
  applyStatusEffect(
    char,
    {
      id: "taken_double",
      name: "Double Taken",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: { damageTakenPct: 1 },
      tags: ["taken_mod"],
      sourceKind: "spell",
      sourceId: "contract_taken_double",
      stackingPolicy: "refresh",
    },
    now0,
  );

  // Absorb shield 10.
  applyStatusEffect(
    char,
    {
      id: "shield_absorb_10",
      name: "Shield 10",
      durationMs: 30_000,
      maxStacks: 1,
      stacks: 1,
      modifiers: {},
      tags: ["shield"],
      sourceKind: "spell",
      sourceId: "contract_shield_10",
      stackingPolicy: "refresh",
      stackingGroupId: "grp_shield_absorb_10",
      absorb: { amount: 10 },
    },
    now0 + 1,
  );

  // Apply 6 damage; taken mods double it to 12, then shield absorbs 10 => 2 HP lost.
  const r = applySimpleDamageToPlayer(ent, 6, char, school, { ignoreServiceProtection: true } as any);
  assert.equal(r.absorbed, 10);
  assert.equal(r.newHp, 98);
  assert.equal(r.killed, false);

  // Shield should be depleted and removed (bucket deleted).
  const effects = getActiveStatusEffects(char, now0 + 2_000);
  const shield = effects.find((e) => e.stackingGroupId === "grp_shield_absorb_10" || e.id === "shield_absorb_10");
  assert.equal(shield, undefined, "expected absorb shield to be removed after full depletion");
});
