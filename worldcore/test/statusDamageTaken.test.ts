// worldcore/test/statusDamageTaken.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import {
  applyStatusEffect,
  clearAllStatusEffects,
} from "../combat/StatusEffects";
import type { Entity } from "../shared/Entity";
import {
  type CharacterState,
  defaultAttributes,
  defaultInventory,
  defaultEquipment,
  defaultSpellbook,
  defaultAbilities,
  defaultProgression,
} from "../characters/CharacterTypes";

function makePlayerEntity(
  hp: number = 100,
  maxHp: number = 100,
): Entity & { inCombatUntil?: number; inCombat?: boolean } {
  return {
    id: "player-1",
    type: "player",
    roomId: "room-1",
    ownerSessionId: "session-1",
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    hp,
    maxHp,
    alive: true,
    name: "TestPlayer",
  };
}

function makeBaseChar(): CharacterState {
  const now = new Date();
  return {
    id: "char-1",
    userId: "user-1",
    shardId: "prime_shard",
    name: "Vulnerability Tester",
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

test("status damageTakenPct increases damage taken", () => {
  const playerBase = makePlayerEntity(100, 100);
  const charBase = makeBaseChar();

  const base = applySimpleDamageToPlayer(playerBase, 10, charBase);

  assert.equal(
    base.newHp,
    90,
    "Baseline 10 damage should reduce HP from 100 to 90",
  );

  const playerVuln = makePlayerEntity(100, 100);
  const charVuln = makeBaseChar();

  // Ensure we start from a clean status state.
  clearAllStatusEffects(charVuln);

  applyStatusEffect(charVuln, {
    id: "debug_vuln_50pct",
    sourceKind: "ability",
    sourceId: "debug_vulnerability",
    name: "Debug Vulnerability",
    durationMs: 60_000,
    maxStacks: 1,
    initialStacks: 1,
    modifiers: {
      damageTakenPct: 0.5, // +50% incoming damage
    },
  });

  const vuln = applySimpleDamageToPlayer(playerVuln, 10, charVuln);

  assert.equal(
    vuln.newHp,
    85,
    "With +50% damageTakenPct, 10 damage should reduce HP from 100 to 85",
  );
  assert.ok(
    vuln.newHp < base.newHp,
    "Vulnerability must cause more damage than baseline",
  );
  assert.equal(
    playerVuln.hp,
    vuln.newHp,
    "Entity hp field should match result.newHp under vulnerability",
  );
});
