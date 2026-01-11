// worldcore/test/serviceProtectionNpcCombat.test.ts
//
// Option A: Lock down "service provider" invulnerability so it can't regress.
// This covers two enforcement layers:
//
// 1) NpcCombat.performNpcAttack(): returns a protection combat line early
//    (when the entity is tagged as a service provider, or when the NPC prototype
//     is recognized as service-protected).
//
// 2) NpcManager.applyDamage(): refuses to reduce HP for service-protected NPCs,
//    even if some caller tries to apply damage directly.
//
// Notes:
// - These tests intentionally avoid depending on any specific built-in NPC ids.
//   We inject small test NPC prototypes into DEFAULT_NPC_PROTOTYPES.
// - We keep behavior-neutral expectations: "protected => no damage", "normal => takes damage".

import test from "node:test";
import assert from "node:assert/strict";

import { performNpcAttack } from "../combat/NpcCombat";
import { serviceProtectedCombatLine } from "../combat/ServiceProtection";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";

import type { CharacterState } from "../characters/CharacterTypes";
import type { Entity } from "../shared/Entity";

function dummyChar(id: string): CharacterState {
  const now = new Date();

  // We only need a "shape" that satisfies callers; performNpcAttack returns
  // before it reads most of this in the service-protected branch.
  return {
    id,
    userId: "user-test",
    name: "Tester",
    shardId: "prime_shard",
    classId: "warrior",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: null,
    appearanceTag: null,
    attributes: { str: 10, agi: 10, int: 10, sta: 10, wis: 10, cha: 10 },
    inventory: { bags: [], currency: {} },
    equipment: {},
    spellbook: { known: {} },
    abilities: {},
    progression: {},
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

test("performNpcAttack: entity-tagged service providers are immune and return a protection line", async () => {
  const char = dummyChar("char-service-tag");
  const player: Entity = {
    id: "player-service-tag",
    type: "player",
    roomId: "room-service-tag",
    ownerSessionId: "sess-service-tag",
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Player",
  } as any;

  const serviceNpc: Entity = {
    id: "npc-service-tag",
    type: "npc",
    roomId: "room-service-tag",
    hp: 100,
    maxHp: 100,
    alive: true,
    name: "Test Banker",
    tags: ["service_bank"],
  } as any;

  const line = await performNpcAttack({} as any, char, player, serviceNpc);

  assert.equal(line, serviceProtectedCombatLine("Test Banker"));
  assert.equal((serviceNpc as any).hp, 100, "service NPC hp must not change");
});

test("NpcManager.applyDamage: service-protected prototypes ignore damage and cannot die", () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  // Inject a service provider prototype (bank/mailbox/auctioneer style).
  const serviceProtoId = "test_service_banker";
  (DEFAULT_NPC_PROTOTYPES as any)[serviceProtoId] = {
    id: serviceProtoId,
    name: "Test Banker",
    level: 1,
    maxHp: 120,
    baseDamageMin: 0,
    baseDamageMax: 0,
    model: "banker",
    tags: ["service_bank", "town"],
    behavior: "neutral",
    xpReward: 0,
    loot: [],
  };

  const st = npcs.spawnNpcById(serviceProtoId, "room-service-proto", 0, 0, 0);
  assert.ok(st, "expected service NPC to spawn");

  const ent = entities.get(st!.entityId) as any;
  assert.ok(ent, "expected entity for service NPC");
  assert.equal(ent.hp, 120);
  assert.equal(ent.maxHp, 120);

  // Attempt to kill it.
  const ret = npcs.applyDamage(st!.entityId, 9999, { entityId: "attacker" as any });
  assert.equal(ret, 120, "applyDamage should return unchanged hp for service NPCs");

  assert.equal(ent.hp, 120, "service NPC hp must not change");
  assert.equal(ent.alive, true, "service NPC must remain alive");
  assert.equal(ent.invulnerable, true, "service NPC should be marked invulnerable");
  assert.equal(ent.isServiceProvider, true, "service NPC should be marked as a service provider");
});

test("NpcManager.applyDamage: normal (non-service) NPCs take damage normally", () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const protoId = "test_normal_npc";
  (DEFAULT_NPC_PROTOTYPES as any)[protoId] = {
    id: protoId,
    name: "Test Rat",
    level: 1,
    maxHp: 50,
    baseDamageMin: 1,
    baseDamageMax: 2,
    model: "rat",
    tags: ["wildlife"],
    behavior: "hostile",
    xpReward: 0,
    loot: [],
  };

  const st = npcs.spawnNpcById(protoId, "room-normal-proto", 0, 0, 0);
  assert.ok(st, "expected normal NPC to spawn");

  const ent = entities.get(st!.entityId) as any;
  assert.equal(ent.hp, 50);

  const ret = npcs.applyDamage(st!.entityId, 10, { entityId: "attacker" as any });
  assert.equal(ret, 40);

  assert.equal(ent.hp, 40);
  assert.equal(ent.alive, true);
});
