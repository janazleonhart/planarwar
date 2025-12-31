// worldcore/test/respawn_graveyard.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  RespawnService,
  type RespawnCharacterStore,
} from "../world/RespawnService";
import { EntityManager } from "../core/EntityManager";
import type { CharacterState } from "../characters/CharacterTypes";

// Small helper to build a minimal CharacterState that compiles everywhere
function createCharacter(id: string, regionId: string): CharacterState {
  const now = new Date();

  return {
    id,
    userId: "user-respawn",
    shardId: "prime_shard",
    name: "Test Respawn",
    classId: "warrior",
    level: 10,
    xp: 0,
    posX: 100,
    posY: 0,
    posZ: 100,
    lastRegionId: regionId,
    appearanceTag: null,
    attributes: {
      str: 10,
      agi: 10,
      int: 10,
      sta: 10,
      wis: 10,
      cha: 10,
    },
    inventory: {
      bags: [],
      currency: {},
    },
    equipment: {},
    spellbook: {
      known: {},
    },
    abilities: {},
    progression: {},
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

test("RespawnService prefers graveyard spawns within a region", async () => {
  const regionId = "prime_shard:0,0";

  // Fake spawn points for that region: one graveyard, one generic town.
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

  // SpawnPointService stub: only getSpawnPointsForRegion is used in this test.
  const spawnService = {
    async getSpawnPointsForRegion(
      shardId: string,
      region: string,
    ) {
      assert.equal(shardId, "prime_shard");
      assert.equal(region, regionId);
      return [graveyardSpawn, townSpawn];
    },
    async getSpawnPointsNear() {
      // Not used in this test; returning empty ensures we don't accidentally
      // fall back to the "nearby" path.
      return [];
    },
  } as any;

  // World stub: RespawnService only touches getRegionAt in fallback paths.
  const world = {
    getRegionAt() {
      return null;
    },
  } as any;

  // Character store stub: capture whatever RespawnService saves.
  let savedCharacter: CharacterState | undefined;

  const store: RespawnCharacterStore = {
    async saveCharacter(state: CharacterState): Promise<void> {
      savedCharacter = state;
    },
  };

  const entities = new EntityManager();

  // Session + entity setup
  const char = createCharacter("char-respawn-1", regionId);

  const session = {
    id: "session-respawn-1",
    character: char,
  } as any;

  const playerEntity = entities.createPlayerForSession(
    session.id,
    "prime_shard:room_test",
  );

  // Simulate being dead & hurt before respawn.
  (playerEntity as any).alive = false;
  (playerEntity as any).maxHp = 50;
  (playerEntity as any).hp = 5;
  playerEntity.x = char.posX;
  playerEntity.y = char.posY;
  playerEntity.z = char.posZ;

  const respawn = new RespawnService(
    world,
    spawnService,
    store,
    entities,
  );

  const { character: after, spawn } = await respawn.respawnCharacter(
    session,
    char,
  );

  // 1) We should have chosen the graveyard spawn, not the town spawn.
  assert.ok(spawn, "spawn should not be null");
  assert.equal(spawn!.spawnId, "gy_1");
  assert.equal(spawn!.type, "graveyard");

  // 2) Character position should match the graveyard coordinates.
  assert.equal(after.posX, graveyardSpawn.x);
  assert.equal(after.posY, graveyardSpawn.y);
  assert.equal(after.posZ, graveyardSpawn.z);
  assert.equal(after.lastRegionId, regionId);

  // 3) The saved character should match the new position.
  assert.ok(savedCharacter, "saveCharacter should have been called");
  const sc = savedCharacter as CharacterState;

  assert.equal(sc.posX, graveyardSpawn.x);
  assert.equal(sc.posY, graveyardSpawn.y);
  assert.equal(sc.posZ, graveyardSpawn.z);

  // 4) The runtime entity for this session should be moved + fully healed.
  const entAfter = entities.getEntityByOwner(session.id);
  assert.ok(entAfter, "player entity should still exist");

  const e: any = entAfter;
  assert.equal(e.x, graveyardSpawn.x);
  assert.equal(e.y, graveyardSpawn.y);
  assert.equal(e.z, graveyardSpawn.z);
  assert.equal(e.hp, e.maxHp, "respawn should fully heal the entity");
  assert.equal(e.alive, true, "entity should be marked alive after respawn");
});
