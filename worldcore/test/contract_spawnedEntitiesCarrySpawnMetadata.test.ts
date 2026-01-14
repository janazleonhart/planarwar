import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";

const ROOM_ID = "spawn-room";
const SHARD_ID = "prime_shard";
const REGION_ID = "0,0";

test("[contract] shared NPCs spawned from spawn_points carry spawnPointId/spawnId/regionId metadata", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const spawnPoints = {
    async getSpawnPointsForRegion(_shardId: string, _regionId: string) {
      return [
        {
          id: 42,
          shardId: SHARD_ID,
          spawnId: "sp_rat_42",
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

  const spawned = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(spawned, 1);

  const inRoom = entities.getEntitiesInRoom(ROOM_ID) as any[];
  const npcEnt = inRoom.find((e) => e.type === "npc");
  assert.ok(npcEnt, "Expected at least one npc in room");

  assert.equal((npcEnt as any).spawnPointId, 42, "spawnPointId must be attached");
  assert.equal((npcEnt as any).spawnId, "sp_rat_42", "spawnId must be attached");
  assert.equal((npcEnt as any).regionId, REGION_ID, "regionId must be attached");
});

test("[contract] personal nodes spawned from spawn_points carry spawnPointId/spawnId/regionId and ownerSessionId", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const ownerSessionId = "sess-owner";
  const char: any = {
    id: "char1",
    shardId: SHARD_ID,
    progression: {}, // allow node
  };

  const spawnPoints = {
    async getSpawnPointsForRegion(_shardId: string, _regionId: string) {
      return [
        {
          id: 101,
          shardId: SHARD_ID,
          spawnId: "sp_ore_101",
          type: "resource",
          protoId: "ore_iron_hematite",
          variantId: null,
          archetype: "resource",
          x: 5,
          y: 0,
          z: 6,
          regionId: REGION_ID,
        },
      ] as any[];
    },
    async getSpawnPointsNear() {
      return [] as any[];
    },
  } as any;

  const controller = new NpcSpawnController({ spawnPoints, npcs, entities });

  const spawned = await controller.spawnPersonalNodesFromRegion(
    SHARD_ID,
    REGION_ID,
    ROOM_ID,
    ownerSessionId,
    char,
  );

  assert.equal(spawned, 1);

  const inRoom = entities.getEntitiesInRoom(ROOM_ID) as any[];
  const nodeEnt = inRoom.find(
    (e) => (e.type === "node" || e.type === "object") && e.ownerSessionId === ownerSessionId,
  );
  assert.ok(nodeEnt, "Expected an owned node/object in room");

  assert.equal((nodeEnt as any).spawnPointId, 101, "spawnPointId must be attached");
  assert.equal((nodeEnt as any).spawnId, "sp_ore_101", "spawnId must be attached");
  assert.equal((nodeEnt as any).regionId, REGION_ID, "regionId must be attached");
  assert.equal((nodeEnt as any).ownerSessionId, ownerSessionId, "ownerSessionId must be attached");
});
