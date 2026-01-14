import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";

const SHARD_ID = "prime_shard";

function getNpcsInRoom(entities: EntityManager, roomId: string): any[] {
  return (entities.getEntitiesInRoom(roomId) as any[]).filter((e) => e && e.type === "npc");
}

function mustFindNpcWithSpawnPointId(npcs: any[], spawnPointId: number): any {
  const hit = npcs.find((e) => (e as any).spawnPointId === spawnPointId);
  assert.ok(hit, `Expected NPC with spawnPointId=${spawnPointId}`);
  return hit;
}

test("Lane T1/T2: spawnFromRegion is idempotent and replaces only missing shared NPCs", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const ROOM_ID = "room_refresh";
  const REGION_ID = "0,0";

  const spawnPoints = {
    async getSpawnPointsForRegion(_shardId: string, regionId: string) {
      assert.equal(regionId, REGION_ID);

      return [
        {
          id: 1,
          shardId: SHARD_ID,
          spawnId: "sp_rat_1",
          type: "npc",
          protoId: "town_rat",
          variantId: null,
          archetype: "npc",
          x: 10,
          y: 0,
          z: 10,
          regionId: REGION_ID,
        },
        {
          id: 2,
          shardId: SHARD_ID,
          spawnId: "sp_rat_2",
          type: "npc",
          protoId: "town_rat",
          variantId: null,
          archetype: "npc",
          x: 12,
          y: 0,
          z: 12,
          regionId: REGION_ID,
        },
      ] as any[];
    },

    async getSpawnPointsNear() {
      return [] as any[];
    },
  } as any;

  const controller = new NpcSpawnController({ spawnPoints, npcs, entities });

  // First spawn: 2 NPCs
  const spawned1 = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(spawned1, 2, "first call should spawn all missing shared NPCs");

  let inRoom = getNpcsInRoom(entities, ROOM_ID);
  assert.equal(inRoom.length, 2, "room should have 2 NPCs after first spawn");

  // Second call (idempotent): 0
  const spawned2 = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(spawned2, 0, "second call should spawn nothing (idempotent)");

  // Despawn exactly one NPC (spawnPointId=1)
  inRoom = getNpcsInRoom(entities, ROOM_ID);
  const npc1 = mustFindNpcWithSpawnPointId(inRoom, 1);
  npcs.despawnNpc(npc1.id);

  inRoom = getNpcsInRoom(entities, ROOM_ID);
  assert.equal(inRoom.length, 1, "after despawn, room should have 1 NPC left");

  // Refresh should replace exactly 1
  const spawned3 = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(spawned3, 1, "refresh should replace exactly the missing NPC");

  inRoom = getNpcsInRoom(entities, ROOM_ID);
  assert.equal(inRoom.length, 2, "after refresh, room should have 2 NPCs again");

  // Verify both spawnPointIds present again
  mustFindNpcWithSpawnPointId(inRoom, 1);
  mustFindNpcWithSpawnPointId(inRoom, 2);

  // And still idempotent after repair
  const spawned4 = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(spawned4, 0, "after repair, additional refresh should be idempotent");
});

test("Lane T3: refresh is room-local (no cross-contamination between rooms)", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const ROOM_A = "room_A";
  const ROOM_B = "room_B";

  const REGION_A = "0,0";
  const REGION_B = "1,1";

  const spawnPoints = {
    async getSpawnPointsForRegion(_shardId: string, regionId: string) {
      if (regionId === REGION_A) {
        return [
          {
            id: 11,
            shardId: SHARD_ID,
            spawnId: "sp_a_11",
            type: "npc",
            protoId: "town_rat",
            variantId: null,
            archetype: "npc",
            x: 1,
            y: 0,
            z: 1,
            regionId: REGION_A,
          },
        ] as any[];
      }

      if (regionId === REGION_B) {
        return [
          {
            id: 22,
            shardId: SHARD_ID,
            spawnId: "sp_b_22",
            type: "npc",
            protoId: "town_rat",
            variantId: null,
            archetype: "npc",
            x: 2,
            y: 0,
            z: 2,
            regionId: REGION_B,
          },
        ] as any[];
      }

      return [] as any[];
    },

    async getSpawnPointsNear() {
      return [] as any[];
    },
  } as any;

  const controller = new NpcSpawnController({ spawnPoints, npcs, entities });

  // Spawn in room A / region A
  const a1 = await controller.spawnFromRegion(SHARD_ID, REGION_A, ROOM_A);
  assert.equal(a1, 1);

  // Spawn in room B / region B
  const b1 = await controller.spawnFromRegion(SHARD_ID, REGION_B, ROOM_B);
  assert.equal(b1, 1);

  let npcsA = getNpcsInRoom(entities, ROOM_A);
  let npcsB = getNpcsInRoom(entities, ROOM_B);
  assert.equal(npcsA.length, 1);
  assert.equal(npcsB.length, 1);

  mustFindNpcWithSpawnPointId(npcsA, 11);
  mustFindNpcWithSpawnPointId(npcsB, 22);

  // Despawn in room A
  const aNpc = mustFindNpcWithSpawnPointId(npcsA, 11);
  npcs.despawnNpc(aNpc.id);

  npcsA = getNpcsInRoom(entities, ROOM_A);
  npcsB = getNpcsInRoom(entities, ROOM_B);
  assert.equal(npcsA.length, 0, "room A NPC removed");
  assert.equal(npcsB.length, 1, "room B unaffected");

  // Refresh room A: should respawn only room A NPC
  const a2 = await controller.spawnFromRegion(SHARD_ID, REGION_A, ROOM_A);
  assert.equal(a2, 1);

  npcsA = getNpcsInRoom(entities, ROOM_A);
  npcsB = getNpcsInRoom(entities, ROOM_B);
  assert.equal(npcsA.length, 1, "room A repaired");
  assert.equal(npcsB.length, 1, "room B still unaffected");

  // Idempotent checks per-room
  const a3 = await controller.spawnFromRegion(SHARD_ID, REGION_A, ROOM_A);
  const b2 = await controller.spawnFromRegion(SHARD_ID, REGION_B, ROOM_B);
  assert.equal(a3, 0);
  assert.equal(b2, 0);
});
