// worldcore/test/behavior_reloadSpawnsHereReconcilesSharedNpcs.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleReloadCommand } from "../mud/commands/debug/reloadCommand";

test("[behavior] reload spawns --here reconciles shared NPCs (despawn stale, keep nodes/personal)", async () => {
  const despawned: any[] = [];
  const spawnNearCalls: any[] = [];

  const spawnService: any = {
    getSpawnPointsNear: async (_shardId: string, _x: number, _z: number, _radius: number) => {
      // Desired NPC spawn_points in-scope: only id=10
      return [
        { id: 10, type: "npc" },
        { id: 99, type: "node" }, // should be ignored by desiredNpcIds
      ];
    },
    getSpawnPointsForRegion: async () => [],
  };

  const ctx: any = {
    session: { id: "sess1" },
    items: undefined,

    // Provide the controller directly to avoid importing/constructing real NpcSpawnController
    npcSpawns: {
      deps: { spawnPoints: spawnService },
      spawnNear: async (shardId: string, x: number, z: number, radius: number, roomId: string) => {
        spawnNearCalls.push({ shardId, x, z, radius, roomId });
        return 3;
      },
      spawnFromRegion: async () => 0,
    },

    npcs: {
      despawnNpc: (entityId: any) => despawned.push(entityId),
    },

    entities: {
      getEntitiesInRoom: (_roomId: string) => {
        return [
          // Stale shared NPC (spawnPointId=999 not desired) => should despawn
          { id: "npc_stale", type: "npc", spawnPointId: 999, regionId: "prime_shard:0,0", x: 10, z: 10 },
          // Desired shared NPC (spawnPointId=10) => should stay
          { id: "npc_keep", type: "npc", spawnPointId: 10, regionId: "prime_shard:0,0", x: 12, z: 12 },
          // Personal node (ownerSessionId present) => must never despawn
          { id: "node_personal", type: "node", spawnPointId: 888, ownerSessionId: "sess1", regionId: "prime_shard:0,0", x: 11, z: 11 },
        ];
      },
    },

    spawnHydrator: {
      rehydrateRoom: async () => ({ spawned: 0, skippedExisting: 0, eligible: 0, total: 0 }),
    },
  };

  const char: any = {
    roomId: "room:test",
    shardId: "prime_shard",
    lastRegionId: "prime_shard:0,0",
    posX: 10,
    posZ: 10,
  };

  const out = await handleReloadCommand(ctx, char, { args: ["spawns", "--here=50"] } as any);

  // Despawn should only target the stale NPC
  assert.deepEqual(despawned, ["npc_stale"], "Expected only the stale shared NPC to despawn");

  // spawnNear should be called once with the radius we passed
  assert.equal(spawnNearCalls.length, 1, "Expected spawnNear called once");
  assert.equal(spawnNearCalls[0].shardId, "prime_shard");
  assert.equal(spawnNearCalls[0].roomId, "room:test");
  assert.equal(spawnNearCalls[0].radius, 50);
  assert.equal(spawnNearCalls[0].x, 10);
  assert.equal(spawnNearCalls[0].z, 10);

  assert.match(out, /\[reload\] reconcile\(here\):/, "Expected reconcile(here) line");
  assert.match(out, /despawned=1/, "Expected despawned=1 in output");
  assert.match(out, /spawned=3/, "Expected spawned=3 in output");
});
