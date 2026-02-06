// worldcore/test/contract_pet_ai_lite.test.ts
// Contract: pet AI-lite triggers a single swing after a player command when engaged, with cooldown.

import test from "node:test";
import assert from "node:assert/strict";

import { maybePetAutoAttackAfterCommand } from "../mud/MudCommandHandler";

test("[contract] pet AI-lite: engaged owner triggers one pet swing + cooldown", async () => {
  process.env.PW_PET_AI_ENABLED = "true";
  process.env.PW_PET_AI_COOLDOWN_MS = "1200";
  process.env.PW_PET_DAMAGE_MULT = "0.8";

  const owner = { id: "player.1", type: "player", roomId: "prime:0,0", engagedTargetId: "npc.1" } as any;
  const pet = { id: "pet.1", type: "pet", roomId: "prime:0,0", ownerEntityId: "player.1", petMode: "defensive" } as any;
  const target = { id: "npc.1", type: "npc", roomId: "prime:0,0", alive: true, hp: 50, name: "Rat" } as any;

  const entities = {
    getEntityByOwner: (sid: string) => (sid === "sess.1" ? owner : undefined),
    getPetByOwnerEntityId: (ownerId: string) => (ownerId === "player.1" ? pet : undefined),
    getEntitiesInRoom: (roomId: string) => (roomId === "prime:0,0" ? [owner, pet, target] : []),
  } as any;

  const ctx = { session: { id: "sess.1" }, entities } as any;
  const char = { id: "char.1" } as any;

  let swings = 0;
  const perform = async () => {
    swings++;
    return "[combat] Pet hits Rat for 3 damage.";
  };

  const line1 = await maybePetAutoAttackAfterCommand(ctx, char, "attack", { now: 1000, perform: perform as any });
  assert.equal(swings, 1);
  assert.ok(String(line1).startsWith("[pet]"));

  const line2 = await maybePetAutoAttackAfterCommand(ctx, char, "attack", { now: 1500, perform: perform as any });
  assert.equal(swings, 1, "cooldown should prevent a second swing");
  assert.equal(line2, undefined);

  const line3 = await maybePetAutoAttackAfterCommand(ctx, char, "attack", { now: 2201, perform: perform as any });
  assert.equal(swings, 2, "after cooldown, should swing again");
  assert.ok(String(line3).startsWith("[pet]"));
});

test("[contract] pet AI-lite: passive pets never auto-swing", async () => {
  process.env.PW_PET_AI_ENABLED = "true";

  const owner = { id: "player.1", type: "player", roomId: "prime:0,0", engagedTargetId: "npc.1" } as any;
  const pet = { id: "pet.1", type: "pet", roomId: "prime:0,0", ownerEntityId: "player.1", petMode: "passive" } as any;
  const target = { id: "npc.1", type: "npc", roomId: "prime:0,0", alive: true, hp: 50, name: "Rat" } as any;

  const entities = {
    getEntityByOwner: () => owner,
    getPetByOwnerEntityId: () => pet,
    getEntitiesInRoom: () => [owner, pet, target],
  } as any;

  const ctx = { session: { id: "sess.1" }, entities } as any;
  const char = { id: "char.1" } as any;

  let swings = 0;
  const perform = async () => {
    swings++;
    return "[combat] Pet hits Rat for 3 damage.";
  };

  const line = await maybePetAutoAttackAfterCommand(ctx, char, "attack", { now: 1000, perform: perform as any });
  assert.equal(swings, 0);
  assert.equal(line, undefined);
});
