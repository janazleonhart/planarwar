// worldcore/test/statusDamageDealt.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { computeDamage } from "../combat/CombatEngine";
import {
  applyStatusEffect,
  clearAllStatusEffects,
} from "../combat/StatusEffects";

import {
  type CharacterState,
  defaultAttributes,
  defaultInventory,
  defaultEquipment,
  defaultSpellbook,
  defaultAbilities,
  defaultProgression,
} from "../characters/CharacterTypes";

import type { Entity } from "../shared/Entity";

function makeBaseChar(): CharacterState {
  const now = new Date();
  return {
    id: "char-1",
    userId: "user-1",
    shardId: "prime_shard",
    name: "Damage Dealer",
    classId: "warrior",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: "prime_shard:0,0",
    appearanceTag: null,
    attributes: defaultAttributes(),
    inventory: defaultInventory(),
    equipment: defaultEquipment(),
    spellbook: defaultSpellbook(),
    abilities: defaultAbilities(),
    progression: defaultProgression(),
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
    guildId: null,
  };
}

function makeTarget(): Entity {
  return {
    id: "dummy-1",
    type: "npc",
    roomId: "room-1",
    ownerSessionId: "session-1",
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    hp: 1000,
    maxHp: 1000,
    alive: true,
    name: "Target Dummy",
  };
}

test("status damageDealtPct increases outgoing damage", () => {
  const originalRandom = Math.random;
  try {
    // Freeze randomness so we don't get crits/glancing or roll variance.
    // roll = 0.8 + 0.4 * 0.5 = 1.0
    // critRoll = 0.5 → no crit
    // glanceRoll = 0.5 → no glance
    Math.random = () => 0.5;

    // --- Baseline, no buffs ---
    const charBase = makeBaseChar();
    clearAllStatusEffects(charBase);

    const targetBase = makeTarget();

    const sourceBase: any = {
      char: charBase,
      effective: {}, // let CombatEngine fall back to char.attributes
      channel: "spell",
      spellSchool: "arcane",
    };

    const targetWrapperBase: any = {
      entity: targetBase,
      armor: 0,
      resist: {},
    };

    const base = computeDamage(sourceBase, targetWrapperBase, {
      basePower: 10,
    });

    // With basePower=10 and roll=1.0, no crits, no buffs:
    assert.equal(
      base.damage,
      10,
      "Without damageDealtPct, outgoing damage should equal basePower=10",
    );

    // --- With +50% damageDealtPct buff ---
    const charBuff = makeBaseChar();
    clearAllStatusEffects(charBuff);

    applyStatusEffect(charBuff, {
      id: "debug_damage_buff_50pct",
      sourceKind: "ability",
      sourceId: "debug_damage_buff",
      name: "Debug Damage Buff",
      durationMs: 60_000,
      maxStacks: 1,
      initialStacks: 1,
      modifiers: {
        damageDealtPct: 0.5, // +50% outgoing damage
      },
    });

    const targetBuff = makeTarget();

    const sourceBuff: any = {
      char: charBuff,
      effective: {},
      channel: "spell",
      spellSchool: "arcane",
    };

    const targetWrapperBuff: any = {
      entity: targetBuff,
      armor: 0,
      resist: {},
    };

    const buffed = computeDamage(sourceBuff, targetWrapperBuff, {
      basePower: 10,
    });

    assert.equal(
      buffed.damage,
      15,
      "With +50% damageDealtPct, 10 base damage should become 15",
    );
    assert.ok(
      buffed.damage > base.damage,
      "Buffed damage must be strictly higher than baseline",
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("status damageDealtPct stacks additively across reapplications", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;

    const char = makeBaseChar();
    clearAllStatusEffects(char);

    const target = makeTarget();
    const targetWrapper: any = {
      entity: target,
      armor: 0,
      resist: {},
    };

    const source: any = {
      char,
      effective: {},
      channel: "ability",
      spellSchool: "arcane",
    };

    // Base with no buff
    const base = computeDamage(source, targetWrapper, { basePower: 10 });
    assert.equal(
      base.damage,
      10,
      "Baseline should be exactly 10 with deterministic roll",
    );

    // Apply a +10% damageDealtPct buff with maxStacks=3
    applyStatusEffect(char, {
      id: "debug_stack_buff",
      sourceKind: "ability",
      sourceId: "stacking_buff",
      name: "Stacking Buff",
      durationMs: 60_000,
      maxStacks: 3,
      initialStacks: 1,
      modifiers: {
        damageDealtPct: 0.1, // +10% per stack
      },
    });

    const oneStack = computeDamage(source, targetWrapper, { basePower: 10 });
    assert.equal(
      oneStack.damage,
      11,
      "At 1 stack, +10% → 11 damage from basePower 10",
    );

    // Re-apply: should go to 2 stacks (20% total)
    applyStatusEffect(char, {
      id: "debug_stack_buff",
      sourceKind: "ability",
      sourceId: "stacking_buff",
      name: "Stacking Buff",
      durationMs: 60_000,
      maxStacks: 3,
      initialStacks: 1,
      modifiers: {
        damageDealtPct: 0.1,
      },
    });

    const twoStacks = computeDamage(source, targetWrapper, { basePower: 10 });
    assert.equal(
      twoStacks.damage,
      12,
      "At 2 stacks, +20% → 12 damage from basePower 10",
    );

    assert.ok(
      twoStacks.damage > oneStack.damage &&
        oneStack.damage > base.damage,
      "Damage should strictly increase with each stack",
    );
  } finally {
    Math.random = originalRandom;
  }
});
