// worldcore/test/contract_townSiege_vendorLockdown.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { WorldEventBus } from "../world/WorldEventBus";
import { TownSiegeService } from "../world/TownSiegeService";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";
import { requireTownService } from "../mud/commands/world/serviceGates";

type FakeEntityManager = {
  getEntitiesInRoom(roomId: string): any[];
};

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test("[contract] Town siege + region economy lockdown denies vendor service", async () => {
  await withEnv(
    {
      // Keep vendor gates deterministic in the harness.
      PW_SERVICE_GATES: "0",
      PW_SERVICE_RADIUS: "3",
      WORLDCORE_TEST: "1",
    },
    async () => {
      // Region flags: opt-in economy lockdown.
      setRegionFlagsTestOverrides({
        prime_shard: {
          "0,0": {
            rules: {
              economy: { lockdownOnSiege: true },
            },
          },
        },
      });

      const events = new WorldEventBus();
      const townSiege = new TownSiegeService(events);

      const roomId = "prime_shard:0,0";
      events.emit("town.sanctuary.siege", {
        shardId: "prime_shard",
        roomId,
        pressureCount: 3,
        windowMs: 10_000,
      });

      const entities: FakeEntityManager = {
        getEntitiesInRoom: (rid) =>
          rid === roomId
            ? [
                {
                  id: "vendor.1",
                  type: "vendor",
                  x: 0,
                  z: 0,
                },
              ]
            : [],
      };

      const ctx: any = {
        session: { roomId, auth: { isAdmin: false } },
        entities,
        townSiege,
      };

      const char: any = { id: "p1", pos: { x: 0, z: 0 } };

      const out = await requireTownService(ctx, char, "vendor", () => "OK");
      assert.equal(typeof out, "string");
      assert.ok(String(out).toLowerCase().includes("siege"), "deny should mention siege");
    },
  );
});

test("[contract] If region does not opt in, vendor service still works during siege", async () => {
  await withEnv(
    {
      PW_SERVICE_GATES: "0",
      PW_SERVICE_RADIUS: "3",
      WORLDCORE_TEST: "1",
    },
    async () => {
      setRegionFlagsTestOverrides({
        prime_shard: {
          "0,0": {
            rules: {
              economy: { lockdownOnSiege: false },
            },
          },
        },
      });

      const events = new WorldEventBus();
      const townSiege = new TownSiegeService(events);

      const roomId = "prime_shard:0,0";
      events.emit("town.sanctuary.siege", {
        shardId: "prime_shard",
        roomId,
        pressureCount: 3,
        windowMs: 10_000,
      });

      const entities: FakeEntityManager = {
        getEntitiesInRoom: (rid) =>
          rid === roomId
            ? [
                {
                  id: "vendor.1",
                  type: "vendor",
                  x: 0,
                  z: 0,
                },
              ]
            : [],
      };

      const ctx: any = {
        session: { roomId, auth: { isAdmin: false } },
        entities,
        townSiege,
      };
      const char: any = { id: "p1", pos: { x: 0, z: 0 } };

      const out = await requireTownService(ctx, char, "vendor", () => "OK");
      assert.equal(out, "OK");
    },
  );
});

test.after(() => {
  setRegionFlagsTestOverrides(null);
});
