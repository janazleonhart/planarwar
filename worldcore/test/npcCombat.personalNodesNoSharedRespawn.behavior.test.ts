import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { NpcSpawnController } from "../npc/NpcSpawnController";
import { scheduleNpcCorpseAndRespawn } from "../combat/NpcCombat";
import type { CharacterState } from "../characters/CharacterTypes";

const ROOM_ID = "lane-x-room";
const SHARD_ID = "prime_shard";
const REGION_ID = "0,0";

function createCharacter(id = "char-lane-x"): CharacterState {
  const now = new Date();
  return {
    id,
    userId: "user-lane-x",
    shardId: SHARD_ID,
    name: "LaneX",
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
  } as any;
}

function makeCtx(npcs: NpcManager, entities: EntityManager) {
  // NpcCombat.scheduleNpcCorpseAndRespawn broadcasts into a room if present.
  const room = { broadcast() {} };
  const rooms = { get: (_roomId: string) => room };

  return {
    npcs,
    entities,
    rooms,
  } as any;
}

async function sleep(ms: number) {
  await new Promise<void>((r) => setTimeout(r, ms));
}

test("Lane X: personal resource nodes must NOT respawn via shared NPC respawn path", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  // Spawn points include:
  // - shared NPC rat (id=1)
  // - personal resource node ore (id=101) (protoId marks it resource via tags)
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
        {
          id: 101,
          shardId: SHARD_ID,
          spawnId: "sp_ore_101",
          type: "npc", // controller treats resource prototypes as personal even if type says npc
          protoId: "ore_iron_hematite",
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

  const char = createCharacter();
  const ownerSessionId = "sess-lane-x";

  // Spawn the personal node
  const spawned = await controller.spawnPersonalNodesFromRegion(
    SHARD_ID,
    REGION_ID,
    ROOM_ID,
    ownerSessionId,
    char,
  );
  assert.equal(spawned, 1, "should spawn one personal node");

  const nodes0 = (entities.getEntitiesInRoom(ROOM_ID) as any[]).filter(
    (e) => (e?.type === "node" || e?.type === "object") && e?.ownerSessionId === ownerSessionId,
  );
  assert.equal(nodes0.length, 1, "expected exactly one owned node in room");

  const nodeEnt0: any = nodes0[0];
  assert.equal(nodeEnt0.spawnPointId, 101, "node should carry spawnPointId");
  assert.equal(nodeEnt0.spawnId, "sp_ore_101", "node should carry spawnId");
  assert.equal(nodeEnt0.regionId, REGION_ID, "node should carry regionId");
  assert.equal(nodeEnt0.ownerSessionId, ownerSessionId, "node should carry ownerSessionId");

  // Now try to route it through the shared NPC respawn path:
  // Expected behavior: it despawns (corpse cleanup), but does NOT respawn as shared.
  const ctx = makeCtx(npcs, entities);
  scheduleNpcCorpseAndRespawn(ctx, nodeEnt0.id);

  // In WORLDCORE_TEST mode this should be very fast (corpse ~5ms, respawn ~60ms).
  await sleep(120);

  const nodesAfter = (entities.getEntitiesInRoom(ROOM_ID) as any[]).filter(
    (e) => (e?.type === "node" || e?.type === "object") && e?.ownerSessionId === ownerSessionId,
  );

  // It should be gone AND not respawned by scheduleNpcCorpseAndRespawn.
  assert.equal(nodesAfter.length, 0, "personal node must not respawn via shared NPC respawn path");

  // But it SHOULD rehydrate again via the personal node spawn path.
  const respawnedViaPersonal = await controller.spawnPersonalNodesFromRegion(
    SHARD_ID,
    REGION_ID,
    ROOM_ID,
    ownerSessionId,
    char,
  );
  assert.equal(respawnedViaPersonal, 1, "personal node should rehydrate via personal spawn path");

  const nodes2 = (entities.getEntitiesInRoom(ROOM_ID) as any[]).filter(
    (e) => (e?.type === "node" || e?.type === "object") && e?.ownerSessionId === ownerSessionId,
  );
  assert.equal(nodes2.length, 1, "rehydrated node should exist again");
  assert.equal((nodes2[0] as any).spawnPointId, 101, "rehydrated node keeps spawnPointId");
  assert.equal((nodes2[0] as any).spawnId, "sp_ore_101", "rehydrated node keeps spawnId");
  assert.equal((nodes2[0] as any).regionId, REGION_ID, "rehydrated node keeps regionId");
  assert.equal((nodes2[0] as any).ownerSessionId, ownerSessionId, "rehydrated node keeps ownerSessionId");
});

test("Lane X control: shared NPCs DO respawn via scheduleNpcCorpseAndRespawn", async () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

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

  const first = await controller.spawnFromRegion(SHARD_ID, REGION_ID, ROOM_ID);
  assert.equal(first, 1, "should spawn one shared NPC");

  const npc0 = (entities.getEntitiesInRoom(ROOM_ID) as any[]).find(
    (e) => (e as any)?.spawnPointId === 1,
  );
  assert.ok(npc0, "expected shared NPC with spawnPointId=1");

  const ctx = makeCtx(npcs, entities);
  scheduleNpcCorpseAndRespawn(ctx, (npc0 as any).id);

  await sleep(120);

  const npcAfter = (entities.getEntitiesInRoom(ROOM_ID) as any[]).find(
    (e) => (e as any)?.spawnPointId === 1,
  );
  assert.ok(npcAfter, "shared NPC should respawn and still be findable by spawnPointId=1");
});
