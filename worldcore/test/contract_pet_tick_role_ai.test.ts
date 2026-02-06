// worldcore/test/contract_pet_tick_role_ai.test.ts
// Contract: Pet AI v1.3 role behaviors (heal + utility).

import test from "node:test";
import assert from "node:assert/strict";
import { tickPetsForCharacter } from "../pets/PetAi";

function dummyChar(id: string): any {
  return { id, name: id, level: 1, hp: 100, maxHp: 100, progression: { statusEffects: { active: {} } } };
}

function makeCtx(opts: {
  sessionId: string;
  ownerEntityId: string;
  roomId: string;
  ownerHp: number;
  ownerMaxHp: number;
  petRole: string;
  engagedTargetId?: string;
}): any {
  const ownerEnt: any = {
    id: opts.ownerEntityId,
    type: "player",
    roomId: opts.roomId,
    engagedTargetId: opts.engagedTargetId,
    alive: true,
    hp: opts.ownerHp,
    maxHp: opts.ownerMaxHp,
  };

  const petEnt: any = {
    id: "pet.1",
    type: "pet",
    roomId: opts.roomId,
    ownerEntityId: opts.ownerEntityId,
    petMode: "defensive",
    followOwner: true,
    petRole: opts.petRole,
    alive: true,
    hp: 40,
    maxHp: 40,
  };

  const target: any = {
    id: "npc.1",
    type: "npc",
    roomId: opts.roomId,
    alive: true,
    hp: 50,
    maxHp: 50,
    name: "rat",
  };

  const entities = {
    getEntityByOwner: (sid: string) => (sid === opts.sessionId ? ownerEnt : undefined),
    getPetByOwnerEntityId: (oid: string) => (oid === opts.ownerEntityId ? petEnt : undefined),
    getEntitiesInRoom: (rid: string) => (rid === opts.roomId ? [ownerEnt, petEnt, target] : []),
  };

  const ctx: any = {
    session: { id: opts.sessionId },
    entities,
    sessions: { values: () => [] },
  };

  return { ctx, ownerEnt, petEnt, target };
}

test("[contract] pet tick: heal role heals owner and does not attack", async () => {
  const { ctx, ownerEnt } = makeCtx({
    sessionId: "sess.heal",
    ownerEntityId: "player.heal",
    roomId: "prime_shard:0,0",
    ownerHp: 40,
    ownerMaxHp: 100,
    petRole: "pet_heal",
    engagedTargetId: "npc.1",
  });

  const ownerChar = dummyChar("char.heal");
  let attacks = 0;
  const perform = async () => {
    attacks++;
    return "[world] Pet bites!";
  };

  const out = await tickPetsForCharacter(ctx as any, ownerChar as any, 1000, { perform });
  assert.ok(String(out).toLowerCase().includes("tends"), `expected heal line, got: ${out}`);
  assert.equal(attacks, 0, "heal pet should not swing when healing");
  assert.ok(ownerEnt.hp > 40, "owner hp should increase");
});

test("[contract] pet tick: utility role may emergency heal but still attacks when stable", async () => {
  const { ctx, ownerEnt } = makeCtx({
    sessionId: "sess.util",
    ownerEntityId: "player.util",
    roomId: "prime_shard:0,0",
    ownerHp: 90,
    ownerMaxHp: 100,
    petRole: "pet_utility",
    engagedTargetId: "npc.1",
  });

  const ownerChar = dummyChar("char.util");
  let attacks = 0;
  const perform = async () => {
    attacks++;
    return "[world] Pet zaps!";
  };

  const out = await tickPetsForCharacter(ctx as any, ownerChar as any, 1000, { perform });
  assert.ok(String(out).toLowerCase().includes("zaps"), `expected attack line, got: ${out}`);
  assert.equal(attacks, 1);
  assert.equal(ownerEnt.hp, 90, "no heal should occur when stable");
});
