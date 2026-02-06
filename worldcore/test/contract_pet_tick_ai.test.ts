// worldcore/test/contract_pet_tick_ai.test.ts
// Contract: Pet Engine v1.2 tick-driven auto-attack respects stance + cooldown.

import test from "node:test";
import assert from "node:assert/strict";
import { tickPetsForCharacter } from "../pets/PetAi";

function dummyChar(id: string): any {
  return { id, name: id, level: 1, hp: 100, maxHp: 100, progression: { statusEffects: { active: {} } } };
}

function makeCtxWithEntities(opts: {
  sessionId: string;
  ownerEntityId: string;
  roomId: string;
  engagedTargetId?: string;
  petMode?: string;
  followOwner?: boolean;
}): any {
  const ownerEnt: any = {
    id: opts.ownerEntityId,
    type: "player",
    roomId: opts.roomId,
    engagedTargetId: opts.engagedTargetId,
  };
  const petEnt: any = {
    id: "pet.1",
    type: "pet",
    roomId: opts.roomId,
    ownerEntityId: opts.ownerEntityId,
    petMode: opts.petMode ?? "defensive",
    followOwner: opts.followOwner ?? true,
    alive: true,
    hp: 40,
    maxHp: 40,
  };
  const target: any = { id: "npc.1", type: "npc", roomId: opts.roomId, alive: true, hp: 50, maxHp: 50, name: "rat" };

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

test("[contract] pet tick: defensive swings when owner engaged and cooldown enforced", async () => {
  const { ctx, petEnt } = makeCtxWithEntities({
    sessionId: "sess.1",
    ownerEntityId: "player.1",
    roomId: "prime_shard:0,0",
    engagedTargetId: "npc.1",
    petMode: "defensive",
  });
  const ownerChar = dummyChar("char.1");
  let calls = 0;
  const perform = async () => {
    calls++;
    return "[world] Pet bites!";
  };

  const now0 = 1000;
  const out1 = await tickPetsForCharacter(ctx as any, ownerChar as any, now0, { perform });
  assert.ok(String(out1).toLowerCase().includes("[pet]"), "should prefix pet tick output");
  assert.equal(calls, 1);

  // Immediately tick again -> cooldown should block.
  const out2 = await tickPetsForCharacter(ctx as any, ownerChar as any, now0 + 10, { perform });
  assert.equal(out2, undefined);
  assert.equal(calls, 1);

  // After cooldown, should swing again.
  (petEnt as any)._pwPetAiNextAt = now0 + 50;
  const out3 = await tickPetsForCharacter(ctx as any, ownerChar as any, now0 + 60, { perform });
  assert.ok(out3);
  assert.equal(calls, 2);
});

test("[contract] pet tick: passive never auto-swings", async () => {
  const { ctx } = makeCtxWithEntities({
    sessionId: "sess.2",
    ownerEntityId: "player.2",
    roomId: "prime_shard:0,0",
    engagedTargetId: "npc.1",
    petMode: "passive",
  });
  const ownerChar = dummyChar("char.2");
  let calls = 0;
  const perform = async () => {
    calls++;
    return "[world] should not happen";
  };

  const out = await tickPetsForCharacter(ctx as any, ownerChar as any, 1000, { perform });
  assert.equal(out, undefined);
  assert.equal(calls, 0);
});
