// worldcore/test/respawn_graveyard.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { RespawnService, type RespawnCharacterStore } from "../world/RespawnService";
import { EntityManager } from "../core/EntityManager";
import type { CharacterState } from "../characters/CharacterTypes";

function createCharacter(id: string, regionId: string, posX = 100, posZ = 100): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "user-respawn",
    shardId: "prime_shard",
    name: "Test Respawn",
    classId: "warrior",
    level: 10,
    xp: 0,
    posX,
    posY: 0,
    posZ,
    lastRegionId: regionId,
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

test("RespawnService uses a closer town/hub over a farther graveyard (if eligible)", async () => {
  const regionId = "prime_shard:0,0";

  // Character dies at (100,100)
  const char = createCharacter("char-respawn-1", regionId, 100, 100);

  // Graveyard is far: (0,0)  => dist^2 = 20000
  const graveyardSpawn = {
    id: 1,
    shardId: "prime_shard",
    spawnId: "gy_1",
    type: "graveyard",
    protoId: "graveyard_default",
    variantId: null,
    archetype: "graveyard_default",
    x: 0,
    y: 0,
    z: 0,
    regionId,
  };

  // Town is closer: (50,50) => dist^2 = 5000
  const townSpawn = {
    id: 2,
    shardId: "prime_shard",
    spawnId: "town_1",
    type: "town",
    protoId: "town_default",
    variantId: null,
    archetype: "town_default",
    x: 50,
    y: 0,
    z: 50,
    regionId,
  };

  const spawnService = {
    async getSpawnPointsForRegion(shardId: string, region: string) {
      assert.equal(shardId, "prime_shard");
      assert.equal(region, regionId);
      return [graveyardSpawn, townSpawn];
    },
    async getSpawnPointsNear() {
      return [];
    },
  } as any;

  const world = { getRegionAt() { return null; } } as any;

  let savedCharacter: CharacterState | undefined;
  const store: RespawnCharacterStore = {
    async saveCharacter(state: CharacterState): Promise<void> {
      savedCharacter = state;
    },
  };

  const entities = new EntityManager();
  const session = { id: "session-respawn-1", character: char } as any;

  const playerEntity = entities.createPlayerForSession(session.id, "prime_shard:room_test");
  (playerEntity as any).alive = false;
  (playerEntity as any).maxHp = 50;
  (playerEntity as any).hp = 5;

  const respawn = new RespawnService(world, spawnService, store, entities);
  const { character: after, spawn } = await respawn.respawnCharacter(session, char);

  assert.ok(spawn, "spawn should not be null");
  assert.equal(spawn!.spawnId, "town_1");
  assert.equal(spawn!.type, "town");

  assert.equal(after.posX, townSpawn.x);
  assert.equal(after.posY, townSpawn.y);
  assert.equal(after.posZ, townSpawn.z);
  assert.equal(after.lastRegionId, regionId);

  assert.ok(savedCharacter, "saveCharacter should have been called");
  assert.equal(savedCharacter!.posX, townSpawn.x);

  const entAfter = entities.getEntityByOwner(session.id);
  assert.ok(entAfter, "player entity should still exist");
  const e: any = entAfter;
  assert.equal(e.x, townSpawn.x);
  assert.equal(e.z, townSpawn.z);
  assert.equal(e.hp, e.maxHp, "respawn should fully heal the entity");
  assert.equal(e.alive, true, "entity should be marked alive after respawn");
});

test("RespawnService falls back to graveyard if the closer settlement is not eligible (variantId='kos')", async () => {
  const regionId = "prime_shard:0,0";

  // Character dies at (100,100)
  const char = createCharacter("char-respawn-2", regionId, 100, 100);

  const graveyardSpawn = {
    id: 10,
    shardId: "prime_shard",
    spawnId: "gy_10",
    type: "graveyard",
    protoId: "graveyard_default",
    variantId: null,
    archetype: "graveyard_default",
    x: 0,
    y: 0,
    z: 0,
    regionId,
  };

  // Town is closer, but flagged KOS/hostile by variantId placeholder.
  const townSpawn = {
    id: 11,
    shardId: "prime_shard",
    spawnId: "town_kos",
    type: "town",
    protoId: "town_default",
    variantId: "kos",
    archetype: "town_default",
    x: 50,
    y: 0,
    z: 50,
    regionId,
  };

  const spawnService = {
    async getSpawnPointsForRegion() {
      return [graveyardSpawn, townSpawn];
    },
    async getSpawnPointsNear() {
      return [];
    },
  } as any;

  const world = { getRegionAt() { return null; } } as any;

  const store: RespawnCharacterStore = {
    async saveCharacter(): Promise<void> {},
  };

  const entities = new EntityManager();
  const session = { id: "session-respawn-2", character: char } as any;
  entities.createPlayerForSession(session.id, "prime_shard:room_test");

  const respawn = new RespawnService(world, spawnService, store, entities);
  const { spawn } = await respawn.respawnCharacter(session, char);

  assert.ok(spawn, "spawn should not be null");
  assert.equal(spawn!.spawnId, "gy_10");
  assert.equal(spawn!.type, "graveyard");
});
