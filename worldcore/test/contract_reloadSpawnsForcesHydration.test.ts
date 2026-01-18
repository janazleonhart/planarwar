// worldcore/test/contract_reloadSpawnsForcesHydration.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleReloadCommand } from "../mud/commands/debug/reloadCommand";

test("[contract] reload spawns forces SpawnHydrator.rehydrateRoom(force=true)", async () => {
  const calls: any[] = [];

  const ctx: any = {
    session: { id: "sess1" },
    items: undefined,
    // Provide spawnPoints deps in the shape reloadCommand expects (ctx.npcSpawns.deps.spawnPoints)
    npcSpawns: {
      deps: {
        spawnPoints: {
          // Not needed for this test; hot reload spawns may still run cache clear paths.
          getSpawnPointsNear: async () => [],
          getSpawnPointsForRegion: async () => [],
        },
      },
    },
    spawnHydrator: {
      rehydrateRoom: async (opts: any) => {
        calls.push(opts);
        return { spawned: 1, skippedExisting: 0, eligible: 1, total: 1 };
      },
    },
  };

  const char: any = {
    roomId: "room:test",
    shardId: "prime_shard",
    lastRegionId: "prime_shard:0,0",
    posX: 0,
    posZ: 0,
  };

  const out = await handleReloadCommand(ctx, char, { args: ["spawns"] } as any);

  assert.equal(calls.length, 1, "Expected exactly one rehydrateRoom call");
  assert.equal(calls[0].shardId, "prime_shard");
  assert.equal(calls[0].regionId, "prime_shard:0,0");
  assert.equal(calls[0].roomId, "room:test");
  assert.equal(calls[0].force, true, "Expected force=true");

  assert.match(out, /\[reload\] rehydrate:/, "Expected reload output to include rehydrate line");
  assert.match(out, /spawned=1/, "Expected spawned count in output");
});
