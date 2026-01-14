// worldcore/test/respawnServiceInvariants.test.ts
//
// Lane M3 (behavioral):
// RespawnService.respawnCharacter:
// - persists updated CharacterState
// - updates session.character snapshot
// - heals entity to full and marks alive=true
// - clears inCombatUntil
//
// We stub SpawnPointService + world to avoid DB and keep it deterministic.

import test from "node:test";
import assert from "node:assert/strict";

import { RespawnService } from "../world/RespawnService";

test("[behavior] RespawnService respawns in place when no spawnpoints and full-heals entity", async () => {
  const ent: any = {
    id: "entity_p1",
    x: 10,
    y: 0,
    z: 20,
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
    posX: 10,
    posY: 0,
    posZ: 20,
    lastRegionId: "prime_shard:0,0",
  };

  let savedChar: any = null;

  const worldStub: any = {
    getRegionAt(_x: number, _z: number) {
      return null; // no fallback region spawns
    },
  };

  const spawnPointsStub: any = {
    async getSpawnPointsForRegion(_shardId: string, _regionId: string) {
      return [];
    },
    async getSpawnPointsNear(_shardId: string, _x: number, _z: number, _radius: number) {
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

  const res = await svc.respawnCharacter(session, char);

  // Persisted state
  assert.ok(savedChar, "Expected saveCharacter to be called");
  assert.equal(savedChar.id, "p1");
  assert.equal(savedChar.posX, 10);
  assert.equal(savedChar.posY, 0);
  assert.equal(savedChar.posZ, 20);
  assert.equal(savedChar.lastRegionId, "prime_shard:0,0");

  // Session snapshot updated
  assert.ok(session.character, "Expected session.character to exist");
  assert.equal(session.character.id, "p1");
  assert.equal(session.character.posX, 10);

  // Entity healed + flags reset
  assert.equal(ent.alive, true);
  assert.equal(ent.hp, 100);
  assert.equal(ent.maxHp, 100);
  assert.equal(ent.inCombatUntil, 0);

  // Return shape
  assert.ok(res.character);
  assert.equal(res.spawn, null);
});
