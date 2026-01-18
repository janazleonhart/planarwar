// worldcore/test/behavior_reloadSpawnsRegionReconcilesSharedNpcs.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleReloadCommand } from "../mud/commands/debug/reloadCommand";

test("[behavior] reload spawns --region reconciles shared NPCs for the current region", async () => {
  const despawned: any[] = [];
  const spawnFromRegionCalls: any[] = [];

  const spawnService: any = {
    getSpawnPointsForRegion: async (_shardId: string, _regionId: string) => {
      // Desired NPC spawn_points for region: ids 1 and 2
      return [{ id: 1, type: "npc" }, { id: 2, type: "npc" }];
    },
    getSpawnPointsNear: async () => [],
  };

  const ctx: any = {
    session: { id: "sess1" },
    items: undefined,

    npcSpawns: {
      deps: { spawnPoints: spawnService },
      spawnNear: async () => 0,
      spawnFromRegion: async (shardId: string, regionId: string, roomId: string) => {
        spawnFromRegionCalls.push({ shardId, regionId, roomId });
        return 5;
      },
    },

    npcs: {
      despawnNpc: (entityId: any) => despawned.push(entityId),
    },

    entities: {
      getEntitiesInRoom: (_roomId: string) => {
        return [
          // Desired shared NPC (spawnPointId=1) => should stay
          { id: "npc_keep", type: "npc", spawnPointId: 1, regionId: "prime_shard:0,0", x: 0, z: 0 },
          // Stale shared NPC (spawnPointId=3 not desired) => should despawn
          { id: "npc_stale", type: "npc", spawnPointId: 3, regionId: "prime_shard:0,0", x: 0, z: 0 },
          // A node should never be despawned by reconcile
          { id: "node_keep", type: "node", spawnPointId: 999, regionId: "prime_shard:0,0", x: 0, z: 0 },
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
    posX: 0,
    posZ: 0,
  };

  const out = await handleReloadCommand(ctx, char, { args: ["spawns", "--region"] } as any);

  assert.deepEqual(despawned, ["npc_stale"], "Expected only stale shared NPC to despawn");

  assert.equal(spawnFromRegionCalls.length, 1, "Expected spawnFromRegion called once");
  assert.equal(spawnFromRegionCalls[0].shardId, "prime_shard");
  assert.equal(spawnFromRegionCalls[0].regionId, "prime_shard:0,0");
  assert.equal(spawnFromRegionCalls[0].roomId, "room:test");

  assert.match(out, /\[reload\] reconcile\(region\):/, "Expected reconcile(region) line");
  assert.match(out, /despawned=1/, "Expected despawned=1 in output");
  assert.match(out, /spawned=5/, "Expected spawned=5 in output");
});
