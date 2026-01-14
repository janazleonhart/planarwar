// worldcore/test/respawnRegionSemanticsPreference.test.ts
//
// Lane P (behavioral):
// RegionManager semantics can influence RespawnService spawn choice.
//
// Proves:
// - Graveyard regions prefer graveyard spawns even if a settlement is closer.
// - Safe hubs prefer settlement spawns even if a graveyard is closer.
//
// NOTE: RespawnService consults RegionManager semantics only if the host world exposes
// isGraveyardRegion(...) and isSafeHubRegion(...) via world.regionManager (or world.regions).

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
  partial: Partial<DbSpawnPoint> &
    Pick<DbSpawnPoint, "id" | "spawnId" | "type" | "x" | "y" | "z" | "regionId">,
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
  lastRegionId: string;
  regionSpawns: DbSpawnPoint[];
  semantics: { graveyard: boolean; safeHub: boolean };
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
    lastRegionId: opts.lastRegionId,
  };

  let savedChar: any = null;

  const worldStub: any = {
    getRegionAt(_x: number, _z: number) {
      return null;
    },
    regionManager: {
      isGraveyardRegion: (regionId: string) =>
        regionId === opts.lastRegionId ? opts.semantics.graveyard : false,
      isSafeHubRegion: (regionId: string) =>
        regionId === opts.lastRegionId ? opts.semantics.safeHub : false,
    },
  };

  const spawnPointsStub: any = {
    async getSpawnPointsForRegion(_shardId: string, regionId: string) {
      return regionId === opts.lastRegionId ? opts.regionSpawns : [];
    },
    async getSpawnPointsNear() {
      return [];
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

  const svc = new RespawnService(
    worldStub,
    spawnPointsStub,
    charactersStub,
    entitiesStub,
  );

  return { svc, session, char, ent, getSaved: () => savedChar };
}

test("[behavior] graveyard region prefers graveyard even when settlement is closer", async () => {
  const h = makeHarness({
    lastRegionId: "prime_shard:0,0",
    semantics: { graveyard: true, safeHub: false },
    regionSpawns: [
      // Settlement is closer (x=10), but graveyard should win due to region semantics.
      sp({
        id: 1,
        spawnId: "town_close",
        type: "town",
        x: 10,
        y: 0,
        z: 0,
        regionId: "prime_shard:0,0",
      }),
      sp({
        id: 2,
        spawnId: "gy_far",
        type: "graveyard",
        x: 100,
        y: 0,
        z: 0,
        regionId: "prime_shard:0,0",
      }),
    ],
  });

  const r = await h.svc.respawnCharacter(h.session, h.char);
  assert.equal(r.spawn?.spawnId, "gy_far");

  const saved = h.getSaved();
  assert.ok(saved);
  assert.equal(saved.posX, 100);
  assert.equal(saved.lastRegionId, "prime_shard:0,0");
});

test("[behavior] safe hub prefers settlement even when graveyard is closer", async () => {
  const h = makeHarness({
    lastRegionId: "prime_shard:0,0",
    semantics: { graveyard: false, safeHub: true },
    regionSpawns: [
      // Graveyard is closer (x=5), but settlement should win due to safe hub semantics.
      sp({
        id: 1,
        spawnId: "gy_close",
        type: "graveyard",
        x: 5,
        y: 0,
        z: 0,
        regionId: "prime_shard:0,0",
      }),
      sp({
        id: 2,
        spawnId: "town_far",
        type: "town",
        x: 50,
        y: 0,
        z: 0,
        regionId: "prime_shard:0,0",
      }),
    ],
  });

  const r = await h.svc.respawnCharacter(h.session, h.char);
  assert.equal(r.spawn?.spawnId, "town_far");

  const saved = h.getSaved();
  assert.ok(saved);
  assert.equal(saved.posX, 50);
  assert.equal(saved.lastRegionId, "prime_shard:0,0");
});
