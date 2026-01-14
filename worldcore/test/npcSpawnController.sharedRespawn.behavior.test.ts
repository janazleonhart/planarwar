import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";

const ROOM_ID = "spawn-room";
const SHARD_ID = "prime_shard";
const REGION_ID = "0,0";

test("NpcSpawnController: shared NPC respawns if it is despawned", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  // Fake SpawnPointService: 1 NPC spawn point
  const spawnPoints = {
    async getSpawnPointsForRegion(_shardId: string, _regionId: string) {
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
      ] as any[];
    },
    async getSpawnPointsNear() {
      return [] as any[];
    },
  } as any;

  const controller = new NpcSpawnController({ spawnPoints, npcs, entities });

  // 1) First spawn
  const spawned1 = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(spawned1, 1, "first call should spawn the NPC");

  let inRoom = entities.getEntitiesInRoom(ROOM_ID) as any[];
  let npcEnts = inRoom.filter((e) => e.type === "npc");
  assert.equal(npcEnts.length, 1, "room should contain exactly 1 npc after spawn");

  const firstNpc = npcEnts[0];
  const firstId = firstNpc.id;
  assert.equal(firstNpc.x, 10, "npc x should match spawn point");
  assert.equal(firstNpc.z, 10, "npc z should match spawn point");

  // 2) Despawn it (simulate cleanup / reset)
  npcs.despawnNpc(firstId);

  inRoom = entities.getEntitiesInRoom(ROOM_ID) as any[];
  npcEnts = inRoom.filter((e) => e.type === "npc");
  assert.equal(npcEnts.length, 0, "npc should be gone after despawn");

  // 3) Spawn again: must recreate
  const spawned2 = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(spawned2, 1, "second call should respawn the NPC since it no longer exists");

  inRoom = entities.getEntitiesInRoom(ROOM_ID) as any[];
  npcEnts = inRoom.filter((e) => e.type === "npc");
  assert.equal(npcEnts.length, 1, "room should contain exactly 1 npc after respawn");

  const secondNpc = npcEnts[0];
  assert.notEqual(secondNpc.id, firstId, "respawn should create a new entity id");
  assert.equal(secondNpc.x, 10, "respawn npc x should match spawn point");
  assert.equal(secondNpc.z, 10, "respawn npc z should match spawn point");
});
