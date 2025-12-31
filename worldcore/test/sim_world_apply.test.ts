// worldcore/test/sim_world_apply.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { SimWorld } from "../sim/SimWorld";
import { applyActions } from "../sim/BrainActions";

test("SimWorld: applyActions places spawns and queryNear finds them", () => {
  const world = new SimWorld();

  const actions = [
    {
      kind: "place_spawn",
      spawn: {
        shardId: "prime_shard",
        spawnId: "gy_test",
        type: "graveyard",
        protoId: "graveyard",
        variantId: null,
        archetype: "graveyard",
        x: 0,
        y: 0,
        z: 0,
        regionId: "prime_shard:0,0",
      },
    },
    {
      kind: "place_spawn",
      spawn: {
        shardId: "prime_shard",
        spawnId: "outpost_test",
        type: "outpost",
        protoId: "outpost",
        variantId: null,
        archetype: "outpost",
        x: 100,
        y: 0,
        z: 0,
        regionId: "prime_shard:1,0",
      },
    },
  ] as const;

  applyActions(world, actions);

  assert.ok(world.getSpawn("gy_test"));
  assert.ok(world.getSpawn("outpost_test"));

  const nearOrigin = world.listSpawnsNear(0, 0, 10);
  assert.equal(nearOrigin.length, 1);
  assert.equal(nearOrigin[0].spawnId, "gy_test");

  const near100 = world.listSpawnsNear(100, 0, 10);
  assert.equal(near100.length, 1);
  assert.equal(near100[0].spawnId, "outpost_test");
});
