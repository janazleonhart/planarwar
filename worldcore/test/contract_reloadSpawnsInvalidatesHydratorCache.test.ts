// worldcore/test/contract_reloadSpawnsInvalidatesHydratorCache.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { handleReloadCommand } from "../mud/commands/debug/reloadCommand";

test("[contract] reload spawns invalidates SpawnHydrator hydration cache", async () => {
  const events: string[] = [];

  const ctx: any = {
    session: { id: "sess1" },
    items: undefined,
    npcSpawns: {
      deps: {
        spawnPoints: {
          getSpawnPointsNear: async () => [],
          getSpawnPointsForRegion: async () => [],
        },
      },
    },
    spawnHydrator: {
      invalidateAll: () => {
        events.push("invalidate");
      },
      rehydrateRoom: async (_opts: any) => {
        events.push("rehydrate");
        return { spawned: 0, skippedExisting: 0, eligible: 0, total: 0 };
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

  assert.deepEqual(events, ["invalidate", "rehydrate"], "Expected invalidateAll() before rehydrateRoom()");
  assert.match(out, /SpawnHydrator=cleared/, "Expected hot reload report to include SpawnHydrator=cleared");
});
