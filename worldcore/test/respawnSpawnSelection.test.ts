// worldcore/test/respawnSpawnSelection.test.ts
//
// Lane O (behavioral):
// RespawnService spawn selection order + chooseBestSpawn rules.
//
// Proves:
// 1) Region spawns are consulted first.
// 2) If region spawns exist, nearby spawns are NOT consulted.
// 3) chooseBestSpawn prefers closest eligible settlement over farther graveyard.
// 4) If graveyard is closer than eligible settlement, graveyard wins.
// 5) If closest settlement is ineligible (variantId="kos"), fall back to graveyard.
// 6) If region spawns empty, nearby spawns are used.
// 7) If region+nearby empty, origin region spawns are used.

import test from "node:test";
import assert from "node:assert/strict";

import { RespawnService } from "../world/RespawnService";

type DbSpawnPoint = {
  id: number;
  shardId: string;
  spawnId: string;
  type: string;
  archetype: string;
  protoId?: string | null;
  variantId?: string | null;
  x: number;
  y: number;
  z: number;
  regionId: string;
};

function sp(
  partial: Partial<DbSpawnPoint> & Pick<DbSpawnPoint, "id" | "spawnId" | "type" | "x" | "y" | "z" | "regionId">,
): DbSpawnPoint {
  return {
    shardId: "prime_shard",
    archetype: "test",
    protoId: null,
    variantId: null,
    ...partial,
  } as DbSpawnPoint;
}

function makeHarness(opts: {
  lastRegionId?: string | null;
  regionSpawns?: DbSpawnPoint[];
  nearbySpawns?: DbSpawnPoint[] | (() => Promise<DbSpawnPoint[]>);
  originRegionId?: string | null;
  originSpawns?: DbSpawnPoint[];
}) {
  const ent: any = {
    id: "entity_p1",
    x: 0,
    y: 0,
    z: 0,
    hp: 0,
    maxHp: 100,
    alive: false,
    inCombatUntil: Date.now() + 99999,
  };

  const session: any = {
    id: "s1",
    character: { id: "p1" },
  };

  const char: any = {
    id: "p1",
    shardId: "prime_shard",
    posX: 0,
    posY: 0,
    posZ: 0,
    lastRegionId: opts.lastRegionId ?? "prime_shard:0,0",
  };

  let savedChar: any = null;

  const calls = {
    byRegion: 0,
    near: 0,
    originAt: 0,
  };

  const worldStub: any = {
    getRegionAt(x: number, z: number) {
      if (x === 0 && z === 0 && opts.originRegionId) {
        calls.originAt++;
        return { id: opts.originRegionId };
      }
      return null;
    },
  };

  const spawnPointsStub: any = {
    async getSpawnPointsForRegion(_shardId: string, regionId: string) {
      calls.byRegion++;
      // region spawns: only for lastRegionId or origin region
      if (regionId === (opts.lastRegionId ?? "prime_shard:0,0")) return opts.regionSpawns ?? [];
      if (opts.originRegionId && regionId === opts.originRegionId) return opts.originSpawns ?? [];
      return [];
    },
    async getSpawnPointsNear(_shardId: string, _x: number, _z: number, _radius: number) {
      calls.near++;
      if (typeof opts.nearbySpawns === "function") return await opts.nearbySpawns();
      return opts.nearbySpawns ?? [];
    },
  };

  const charactersStub: any = {
    async saveCharacter(state: any) {
      savedChar = state;
    },
  };

  const entitiesStub: any = {
    getEntityByOwner(ownerId: string) {
      return ownerId === session.id ? ent : null;
    },
  };

  const svc = new RespawnService(worldStub, spawnPointsStub, charactersStub, entitiesStub);

  return { svc, session, char, ent, calls, getSaved: () => savedChar };
}

test("[behavior] region spawns are used first; prefer closer eligible settlement over farther graveyard", async () => {
  const h = makeHarness({
    lastRegionId: "prime_shard:0,0",
    regionSpawns: [
      sp({ id: 1, spawnId: "gy_far", type: "graveyard", x: 100, y: 0, z: 0, regionId: "prime_shard:0,0" }),
      sp({ id: 2, spawnId: "town_close", type: "town", x: 10, y: 0, z: 0, regionId: "prime_shard:0,0" }),
    ],
    nearbySpawns: [
      sp({ id: 3, spawnId: "nearby_should_not_be_used", type: "town", x: 1, y: 0, z: 0, regionId: "prime_shard:0,0" }),
    ],
  });

  const r = await h.svc.respawnCharacter(h.session, h.char);

  assert.equal(r.spawn?.spawnId, "town_close");
  assert.equal(h.calls.byRegion, 1, "Expected region spawns to be queried once");
  assert.equal(h.calls.near, 0, "Expected nearby spawns NOT to be queried when region spawn chosen");

  const saved = h.getSaved();
  assert.ok(saved, "Expected CharacterState to be saved");
  assert.equal(saved.posX, 10);
  assert.equal(saved.posZ, 0);
  assert.equal(saved.lastRegionId, "prime_shard:0,0");

  assert.equal(h.ent.hp, 100);
  assert.equal(h.ent.alive, true);
  assert.equal(h.ent.inCombatUntil, 0);
});

test("[behavior] if graveyard is closer than eligible settlement, graveyard wins", async () => {
  const h = makeHarness({
    lastRegionId: "prime_shard:0,0",
    regionSpawns: [
      sp({ id: 1, spawnId: "gy_close", type: "graveyard", x: 5, y: 0, z: 0, regionId: "prime_shard:0,0" }),
      sp({ id: 2, spawnId: "town_far", type: "town", x: 50, y: 0, z: 0, regionId: "prime_shard:0,0" }),
    ],
  });

  const r = await h.svc.respawnCharacter(h.session, h.char);
  assert.equal(r.spawn?.spawnId, "gy_close");
  assert.equal(h.calls.near, 0);
});

test("[behavior] ineligible settlement (variantId='kos') is ignored; fall back to graveyard", async () => {
  const h = makeHarness({
    lastRegionId: "prime_shard:0,0",
    regionSpawns: [
      sp({
        id: 1,
        spawnId: "town_kos_close",
        type: "town",
        variantId: "kos",
        x: 1,
        y: 0,
        z: 0,
        regionId: "prime_shard:0,0",
      }),
      sp({ id: 2, spawnId: "gy_far", type: "graveyard", x: 100, y: 0, z: 0, regionId: "prime_shard:0,0" }),
    ],
  });

  const r = await h.svc.respawnCharacter(h.session, h.char);
  assert.equal(r.spawn?.spawnId, "gy_far");
  assert.equal(h.calls.near, 0);
});

test("[behavior] if region spawns empty, nearby spawns are used", async () => {
  const h = makeHarness({
    lastRegionId: "prime_shard:0,0",
    regionSpawns: [],
    nearbySpawns: [sp({ id: 9, spawnId: "nearby_pick", type: "hub", x: 7, y: 0, z: 0, regionId: "prime_shard:0,0" })],
  });

  const r = await h.svc.respawnCharacter(h.session, h.char);
  assert.equal(h.calls.byRegion, 1);
  assert.equal(h.calls.near, 1);
  assert.equal(r.spawn?.spawnId, "nearby_pick");
});

test("[behavior] if region+nearby empty, origin region spawns are used", async () => {
  const h = makeHarness({
    lastRegionId: "prime_shard:0,0",
    regionSpawns: [],
    nearbySpawns: [],
    originRegionId: "prime_shard:origin",
    originSpawns: [sp({ id: 10, spawnId: "origin_spawn", type: "hub", x: 0, y: 0, z: 0, regionId: "prime_shard:origin" })],
  });

  const r = await h.svc.respawnCharacter(h.session, h.char);

  assert.equal(h.calls.byRegion, 2, "Expected getSpawnPointsForRegion for lastRegionId then origin");
  assert.equal(h.calls.near, 1, "Expected nearby query once before origin fallback");
  assert.equal(h.calls.originAt, 1, "Expected origin getRegionAt(0,0) fallback to be consulted");

  assert.equal(r.spawn?.spawnId, "origin_spawn");
  const saved = h.getSaved();
  assert.equal(saved.lastRegionId, "prime_shard:origin");
});
