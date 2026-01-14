// worldcore/test/contract_spawnedEntitiesHaveHomeCoords.test.ts
//
// Lane W — spawn/home invariants
//
// Goal: prevent future systems from spawning entities without immutable “home” coords.
// - spawnX/spawnY/spawnZ must be set at spawn time
// - spawn_points-driven spawns must also carry spawn metadata
//
// This is a BEHAVIOR test (not static scanning), and uses a mock SpawnPointService
// so it is safe in unit tests (no DB).

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";

import type { CharacterState } from "../characters/CharacterTypes";
import type { DbSpawnPoint, SpawnPointService } from "../world/SpawnPointService";

const ROOM_A = "room_lane_w_a";
const ROOM_B = "room_lane_w_b";

function makeCharacter(id: string, regionId: string): CharacterState {
  // Keep this minimal + permissive. isNodeAvailable(...) should treat missing depletion
  // state as “available”.
  const now = new Date();
  return {
    id,
    userId: "user_lane_w",
    shardId: "prime_shard",
    name: "LaneW",
    classId: "warrior",
    level: 1,
    xp: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: regionId,
    regionId,
    roomId: ROOM_A,
    createdAt: now,
    updatedAt: now,
    // Commonly-present buckets across your codebase; harmless if unused.
    flags: {},
    progression: {},
    status: {},
    inventory: [],
    equipment: {},
  } as any;
}

function makeSpawnPoint(overrides: Partial<DbSpawnPoint>): DbSpawnPoint {
  // DbSpawnPoint shape can evolve; keep it flexible with `as any`.
  return {
    id: 0,
    spawnId: "sp_0",
    shardId: "prime_shard",
    regionId: "prime_shard:0,0",
    type: "npc",
    protoId: "town_rat",
    variantId: null,
    archetype: null,
    x: 10,
    y: 0,
    z: 10,
    ...overrides,
  } as any;
}

function makeMockSpawnPointService(points: DbSpawnPoint[]): SpawnPointService {
  return {
    async getSpawnPointsForRegion(_shardId: string, _regionId: string) {
      return points;
    },
    async getSpawnPointsNear(_shardId: string, _x: number, _z: number, _radius: number) {
      return points;
    },
  } as any;
}

function findEntityBySpawnPointId(entities: EntityManager, roomId: string, spawnPointId: number): any {
  const inRoom = entities.getEntitiesInRoom(roomId) as any[];
  return inRoom.find((e) => (e as any)?.spawnPointId === spawnPointId);
}

test("[contract] NpcManager spawns always set spawnX/spawnY/spawnZ", () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const st = npcs.spawnNpcById("town_rat", ROOM_A, 123, 0, 456);
  assert.ok(st, "spawnNpcById should return a runtime state");

  const ent: any = entities.get(st!.entityId);
  assert.ok(ent, "spawned entity must exist");

  assert.equal(ent.spawnX, 123, "spawnX must match initial spawn X");
  assert.equal(ent.spawnY, 0, "spawnY must match initial spawn Y");
  assert.equal(ent.spawnZ, 456, "spawnZ must match initial spawn Z");

  // Sanity: home coords must be numeric
  assert.equal(typeof ent.spawnX, "number");
  assert.equal(typeof ent.spawnY, "number");
  assert.equal(typeof ent.spawnZ, "number");
});

test("[contract] shared NPC spawn_points spawns carry spawn metadata AND home coords", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const p = makeSpawnPoint({
    id: 42,
    spawnId: "sp_shared_42",
    regionId: "prime_shard:0,0",
    type: "npc",
    protoId: "town_rat",
    x: 10,
    y: 0,
    z: 10,
  });

  const spawnPoints = makeMockSpawnPointService([p]);
  const controller = new NpcSpawnController({ spawnPoints, npcs, entities });

  const spawned = await controller.spawnFromRegion("prime_shard", "prime_shard:0,0", ROOM_A);
  assert.equal(spawned, 1, "expected exactly one shared NPC spawn");

  const ent: any = findEntityBySpawnPointId(entities, ROOM_A, 42);
  assert.ok(ent, "spawned NPC must have spawnPointId attached");

  assert.equal(ent.spawnPointId, 42);
  assert.equal(ent.spawnId, "sp_shared_42");
  assert.equal(ent.regionId, "prime_shard:0,0");

  assert.equal(ent.spawnX, 10, "spawnX must match spawn point X");
  assert.equal(ent.spawnY, 0, "spawnY must match spawn point Y");
  assert.equal(ent.spawnZ, 10, "spawnZ must match spawn point Z");
});

test("[contract] personal node spawn_points spawns carry spawn metadata + ownerSessionId AND home coords", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const p = makeSpawnPoint({
    id: 101,
    spawnId: "sp_ore_101",
    regionId: "prime_shard:0,0",
    type: "node",
    // Use a resource-ish protoId from your project history; type=node is the main signal anyway.
    protoId: "ore_iron_hematite",
    x: 77,
    y: 0,
    z: 88,
  });

  const spawnPoints = makeMockSpawnPointService([p]);
  const controller = new NpcSpawnController({ spawnPoints, npcs, entities });

  const char = makeCharacter("char_lane_w", "prime_shard:0,0");
  const ownerSessionId = "session_lane_w";

  // Tests in your repo call spawnPersonalNodesFromRegion; your controller supports it via alias.
  const spawned = await (controller as any).spawnPersonalNodesFromRegion(
    "prime_shard",
    "prime_shard:0,0",
    ROOM_B,
    ownerSessionId,
    char,
  );

  assert.equal(spawned, 1, "expected exactly one personal node spawn");

  const inRoom = entities.getEntitiesInRoom(ROOM_B) as any[];
  const ent: any = inRoom.find((e) => (e as any)?.spawnPointId === 101);

  assert.ok(ent, "personal node must have spawnPointId attached");
  assert.equal(ent.spawnPointId, 101);
  assert.equal(ent.spawnId, "sp_ore_101");
  assert.equal(ent.regionId, "prime_shard:0,0");
  assert.equal(ent.ownerSessionId, ownerSessionId, "personal nodes must carry ownerSessionId");

  assert.equal(ent.spawnX, 77, "spawnX must match spawn point X");
  assert.equal(ent.spawnY, 0, "spawnY must match spawn point Y");
  assert.equal(ent.spawnZ, 88, "spawnZ must match spawn point Z");
});
