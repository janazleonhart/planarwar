import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";
import { scheduleNpcCorpseAndRespawn } from "../combat/NpcCombat";
import { clearSpawnPointCache, setSpawnPointCoords } from "../world/SpawnPointCache";

const ROOM_ID = "spawn-room";
const SHARD_ID = "prime_shard";
const REGION_ID = "0,0";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("Lane U: shared NPC respawn consults SpawnPointCache when spawnPointId exists", async () => {
  clearSpawnPointCache();

  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const spawnPoints = {
    async getSpawnPointsForRegion() {
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

  const inRoom1 = (entities.getEntitiesInRoom(ROOM_ID) as any[]).filter((e) => e?.type === "npc");
  assert.equal(inRoom1.length, 1);

  const npcEnt1 = inRoom1[0];
  assert.equal((npcEnt1 as any).spawnPointId, 42, "spawnPointId must be attached at spawn time");

  setSpawnPointCoords(42, { x: 99, y: 0, z: 99 });

  const rooms = new Map<string, any>();
  rooms.set(ROOM_ID, { broadcast: () => {} });

  scheduleNpcCorpseAndRespawn({ npcs, entities, rooms } as any, npcEnt1.id);

  await sleep(150);

  const inRoom2 = (entities.getEntitiesInRoom(ROOM_ID) as any[]).filter((e) => e?.type === "npc");
  assert.equal(inRoom2.length, 1);

  const npcEnt2 = inRoom2[0];
  assert.equal(npcEnt2.x, 99, "Respawn X must use cached coords");
  assert.equal(npcEnt2.z, 99, "Respawn Z must use cached coords");
});
