import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";
import type { CharacterState } from "../characters/CharacterTypes";

const ROOM_ID = "spawn-room";
const SHARD_ID = "prime_shard";
const REGION_ID = "0,0";

function createCharacter(id = "char-spawn"): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "user-spawn",
    shardId: SHARD_ID,
    name: "Spawner",
    classId: "virtuoso",
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
    progression: {}, // important: empty => nodes available
    stateVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

test("NpcSpawnController: shared spawn_points spawn NPCs but never resource prototypes", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  // Fake SpawnPointService
  const spawnPoints = {
    async getSpawnPointsForRegion(_shardId: string, _regionId: string) {
      return [
        // Valid shared NPC spawn
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

        // DB might lie and mark a resource as npc. Must be skipped for shared.
        {
          id: 2,
          shardId: SHARD_ID,
          spawnId: "sp_ore_1",
          type: "npc",
          protoId: "ore_iron_hematite",
          variantId: null,
          archetype: "npc",
          x: 12,
          y: 0,
          z: 12,
          regionId: REGION_ID,
        },

        // Non-npc type => ignored
        {
          id: 3,
          shardId: SHARD_ID,
          spawnId: "sp_checkpoint",
          type: "checkpoint",
          protoId: "checkpoint_dummy",
          variantId: null,
          archetype: "checkpoint",
          x: 0,
          y: 0,
          z: 0,
          regionId: REGION_ID,
        },
      ] as any[];
    },

    async getSpawnPointsNear() {
      return [] as any[];
    },
  } as any;

  const controller = new NpcSpawnController({ spawnPoints, npcs, entities });

  const first = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(first, 1, "should spawn exactly 1 shared NPC (rat), skipping resource");

  const inRoom = entities.getEntitiesInRoom(ROOM_ID) as any[];
  const npcsInRoom = inRoom.filter((e) => e.type === "npc");
  const nodesInRoom = inRoom.filter((e) => e.type === "node");

  assert.equal(npcsInRoom.length, 1, "room should contain 1 npc");
  assert.equal(nodesInRoom.length, 0, "shared spawns should not create nodes");
  assert.ok(
    (npcsInRoom[0] as any).name?.toLowerCase().includes("rat"),
    "spawned npc should be the town_rat",
  );

  // Dedupe per-room: second call should do nothing
  const second = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(second, 0, "second shared spawn call should dedupe and spawn nothing");
});

test("NpcSpawnController: personal resource nodes are owned, tagged, and do not duplicate", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const ownerSessionId = "sess-owner";
  const char = createCharacter("char-owner");

  const spawnPoints = {
    async getSpawnPointsForRegion(_shardId: string, _regionId: string) {
      return [
        // Resource node point
        {
          id: 101,
          shardId: SHARD_ID,
          spawnId: "sp_ore_personal",
          type: "resource",
          protoId: "ore_iron_hematite",
          variantId: null,
          archetype: "resource",
          x: 5,
          y: 0,
          z: 6,
          regionId: REGION_ID,
        },

        // Non-resource NPC point should NOT be spawned as personal node
        {
          id: 102,
          shardId: SHARD_ID,
          spawnId: "sp_rat_personal",
          type: "npc",
          protoId: "town_rat",
          variantId: null,
          archetype: "npc",
          x: 7,
          y: 0,
          z: 7,
          regionId: REGION_ID,
        },
      ] as any[];
    },

    async getSpawnPointsNear() {
      return [] as any[];
    },
  } as any;

  const controller = new NpcSpawnController({ spawnPoints, npcs, entities });

  const first = await controller.spawnPersonalNodesFromRegion(
    SHARD_ID,
    REGION_ID,
    ROOM_ID,
    ownerSessionId,
    char,
  );

  assert.equal(first, 1, "should spawn exactly 1 personal resource node");

  const inRoom = entities.getEntitiesInRoom(ROOM_ID) as any[];
  const ownedNodes = inRoom.filter(
    (e) =>
      (e.type === "node" || e.type === "object") &&
      e.ownerSessionId === ownerSessionId &&
      typeof (e as any).spawnPointId === "number",
  );

  assert.equal(ownedNodes.length, 1, "should have exactly one owned node in the room");
  assert.equal((ownedNodes[0] as any).spawnPointId, 101, "node should be tagged with spawnPointId");
  assert.equal((ownedNodes[0] as any).protoId, "ore_iron_hematite", "node should retain protoId");

  // Second call should detect existing tagged node and not duplicate
  const second = await controller.spawnPersonalNodesFromRegion(
    SHARD_ID,
    REGION_ID,
    ROOM_ID,
    ownerSessionId,
    char,
  );

  assert.equal(second, 0, "personal spawn should not duplicate existing owned nodes");
});
