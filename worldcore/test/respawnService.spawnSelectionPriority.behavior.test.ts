// worldcore/test/respawnService.spawnSelectionPriority.behavior.test.ts
//
// Lane Z (behavioral):
// Locks RespawnService spawn selection priority.
//
// Rules:
//  1) Prefer spawns in char.lastRegionId (strongest hint).
//  2) Otherwise look for nearby spawns around current position.
//  3) Otherwise fall back to world origin region (getRegionAt(0,0)).
//  4) Otherwise stand them up where they are (but heal runtime entity).
//
// We stub SpawnPointService + world to avoid DB.

import test from "node:test";
import assert from "node:assert/strict";

import { RespawnService, type RespawnCharacterStore } from "../world/RespawnService";
import { EntityManager } from "../core/EntityManager";
import type { CharacterState } from "../characters/CharacterTypes";

function createCharacter(
  id: string,
  lastRegionId: string | null,
  posX = 100,
  posY = 0,
  posZ = 100,
): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "user-lane-z",
    shardId: "prime_shard",
    name: "Lane Z",
    classId: "virtuoso",
    level: 1,
    xp: 0,
    posX,
    posY,
    posZ,
    lastRegionId,
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
  } as any;
}

test("Lane Z1: pickSpawnPointFor prefers lastRegionId spawns even if a closer nearby spawn exists", async () => {
  const regionA = "prime_shard:1,1";
  const regionB = "prime_shard:9,9";

  // Character died at (100,100), lastRegionId points to regionA.
  const char = createCharacter("pz1", regionA, 100, 0, 100);

  // A region spawn that is FAR away.
  const regionSpawn = {
    id: 1,
    shardId: "prime_shard",
    spawnId: "region_spawn_A",
    type: "town",
    protoId: "town_default",
    variantId: null,
    archetype: "town_default",
    x: 10,
    y: 0,
    z: 10,
    regionId: regionA,
  };

  // A nearby spawn that is MUCH closer, but it belongs to regionB.
  const nearbySpawn = {
    id: 2,
    shardId: "prime_shard",
    spawnId: "nearby_spawn_B",
    type: "town",
    protoId: "town_default",
    variantId: null,
    archetype: "town_default",
    x: 99,
    y: 0,
    z: 99,
    regionId: regionB,
  };

  const world = {
    getRegionAt(_x: number, _z: number) {
      return { id: "prime_shard:0,0" };
    },
  } as any;

  const spawnService = {
    async getSpawnPointsForRegion(shardId: string, regionId: string) {
      assert.equal(shardId, "prime_shard");
      if (regionId === regionA) return [regionSpawn] as any[];
      return [] as any[];
    },
    async getSpawnPointsNear(_shardId: string, _x: number, _z: number, _r: number) {
      return [nearbySpawn] as any[];
    },
  } as any;

  // NOTE: captured as any to avoid TS narrowing weirdness in this repo’s assert typings.
  let saved: any = null;

  const store: RespawnCharacterStore = {
    async saveCharacter(state: CharacterState) {
      saved = state as any;
    },
  };

  const entities = new EntityManager();
  const session = { id: "sess-z1", character: char } as any;

  entities.createPlayerForSession(session.id, "prime_shard:room_test");
  const entBefore = entities.getEntityByOwner(session.id) as any;
  entBefore.maxHp = 100;
  entBefore.hp = 1;
  entBefore.alive = false;
  entBefore.inCombatUntil = 999;

  const respawn = new RespawnService(world, spawnService, store, entities);
  const { character: after, spawn } = await respawn.respawnCharacter(session, char);

  // Must pick regionA spawn because lastRegionId is the strongest hint.
  assert.ok(spawn);
  assert.equal(spawn!.spawnId, "region_spawn_A");
  assert.equal(after.posX, regionSpawn.x);
  assert.equal(after.posZ, regionSpawn.z);
  assert.equal(after.lastRegionId, regionA);

  assert.ok(saved, "Expected saveCharacter to be called");
  assert.equal((saved as any).posX, regionSpawn.x);

  // Runtime entity healed + flags reset
  const entAfter = entities.getEntityByOwner(session.id) as any;
  assert.ok(entAfter);
  assert.equal(entAfter.x, regionSpawn.x);
  assert.equal(entAfter.z, regionSpawn.z);
  assert.equal(entAfter.alive, true);
  assert.equal(entAfter.hp, entAfter.maxHp);
  assert.equal(entAfter.inCombatUntil, 0);
});

test("Lane Z2: if lastRegionId is missing/empty, pickSpawnPointFor uses nearby spawns", async () => {
  const char = createCharacter("pz2", null, 100, 0, 100);

  const nearbySpawn = {
    id: 7,
    shardId: "prime_shard",
    spawnId: "nearby_spawn",
    type: "town",
    protoId: "town_default",
    variantId: null,
    archetype: "town_default",
    x: 120,
    y: 0,
    z: 80,
    regionId: "prime_shard:2,2",
  };

  const world = {
    getRegionAt(_x: number, _z: number) {
      return { id: "prime_shard:0,0" };
    },
  } as any;

  const spawnService = {
    async getSpawnPointsForRegion(_shardId: string, _regionId: string) {
      return [] as any[];
    },
    async getSpawnPointsNear(_shardId: string, _x: number, _z: number, _r: number) {
      return [nearbySpawn] as any[];
    },
  } as any;

  const store: RespawnCharacterStore = {
    async saveCharacter(): Promise<void> {},
  };

  const entities = new EntityManager();
  const session = { id: "sess-z2", character: char } as any;
  entities.createPlayerForSession(session.id, "prime_shard:room_test");

  const respawn = new RespawnService(world, spawnService, store, entities);
  const { character: after, spawn } = await respawn.respawnCharacter(session, char);

  assert.ok(spawn);
  assert.equal(spawn!.spawnId, "nearby_spawn");
  assert.equal(after.posX, nearbySpawn.x);
  assert.equal(after.posZ, nearbySpawn.z);
  assert.equal(after.lastRegionId, nearbySpawn.regionId);
});

test("Lane Z3: if lastRegionId missing and nearby empty, fall back to origin region spawns (world.getRegionAt(0,0))", async () => {
  const char = createCharacter("pz3", null, 100, 0, 100);

  const originRegionId = "prime_shard:0,0";
  const originSpawn = {
    id: 9,
    shardId: "prime_shard",
    spawnId: "origin_spawn",
    type: "graveyard",
    protoId: "graveyard_default",
    variantId: null,
    archetype: "graveyard_default",
    x: 0,
    y: 0,
    z: 0,
    regionId: originRegionId,
  };

  const world = {
    getRegionAt(x: number, z: number) {
      // RespawnService uses getRegionAt(0,0) for fallback.
      assert.equal(x, 0);
      assert.equal(z, 0);
      return { id: originRegionId };
    },
  } as any;

  const spawnService = {
    async getSpawnPointsForRegion(_shardId: string, regionId: string) {
      if (regionId === originRegionId) return [originSpawn] as any[];
      return [] as any[];
    },
    async getSpawnPointsNear() {
      return [] as any[];
    },
  } as any;

  const store: RespawnCharacterStore = {
    async saveCharacter(): Promise<void> {},
  };

  const entities = new EntityManager();
  const session = { id: "sess-z3", character: char } as any;
  entities.createPlayerForSession(session.id, "prime_shard:room_test");

  const respawn = new RespawnService(world, spawnService, store, entities);
  const { character: after, spawn } = await respawn.respawnCharacter(session, char);

  assert.ok(spawn);
  assert.equal(spawn!.spawnId, "origin_spawn");
  assert.equal(after.posX, 0);
  assert.equal(after.posZ, 0);
  assert.equal(after.lastRegionId, originRegionId);
});

test("Lane Z4: if there are no spawns anywhere, respawn stands you up where you died but heals runtime entity", async () => {
  const regionId = "prime_shard:6,6";
  const char = createCharacter("pz4", regionId, 123, 0, 456);

  const world = {
    getRegionAt(_x: number, _z: number) {
      return { id: "prime_shard:0,0" };
    },
  } as any;

  const spawnService = {
    async getSpawnPointsForRegion() {
      return [] as any[];
    },
    async getSpawnPointsNear() {
      return [] as any[];
    },
  } as any;

  const store: RespawnCharacterStore = {
    async saveCharacter(): Promise<void> {},
  };

  const entities = new EntityManager();
  const session = { id: "sess-z4", character: char } as any;
  entities.createPlayerForSession(session.id, "prime_shard:room_test");
  const ent = entities.getEntityByOwner(session.id) as any;
  ent.maxHp = 100;
  ent.hp = 0;
  ent.alive = false;
  ent.inCombatUntil = 999;

  const respawn = new RespawnService(world, spawnService, store, entities);
  const { character: after, spawn } = await respawn.respawnCharacter(session, char);

  assert.equal(spawn, null, "no spawn should be returned");
  assert.equal(after.posX, 123);
  assert.equal(after.posZ, 456);
  assert.equal(after.lastRegionId, regionId);

  const entAfter = entities.getEntityByOwner(session.id) as any;
  assert.equal(entAfter.x, 123);
  assert.equal(entAfter.z, 456);
  assert.equal(entAfter.alive, true);
  assert.equal(entAfter.hp, entAfter.maxHp);
  assert.equal(entAfter.inCombatUntil, 0);
});
