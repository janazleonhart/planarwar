// worldcore/test/recoveryOpsInvariants.test.ts
//
// Lane M2 (behavioral):
// - respawnInPlace fails when alive; succeeds (rez+full) when dead.
// - restOrSleep:
//    * dead -> rez+full
//    * injured -> full restore
//    * full -> "already at full health"

import test from "node:test";
import assert from "node:assert/strict";

import { respawnInPlace, restOrSleep } from "../systems/recovery/recoveryOps";

function makeCtx(ent: any) {
  return {
    session: { id: "s1" },
    entities: {
      getEntityByOwner(sessionId: string) {
        return sessionId === "s1" ? ent : null;
      },
    },
    stopAutoAttack() {
      return "stopped";
    },
    stopTrainingDummyAi() {
      /* noop */
    },
  } as any;
}

test("[behavior] respawnInPlace only works when dead", () => {
  const ent: any = { hp: 10, maxHp: 100, alive: true };
  const ctx = makeCtx(ent);

  const aliveMsg = respawnInPlace(ctx);
  assert.equal(aliveMsg, "You are not dead.");
  assert.equal(ent.hp, 10);

  ent.hp = 0;
  ent.alive = false;

  const deadMsg = respawnInPlace(ctx);
  assert.equal(deadMsg, "You pull yourself back together and feel fully restored.");
  assert.equal(ent.hp, 100);
  assert.equal(ent.maxHp, 100);
  assert.equal(ent.alive, true);
});

test("[behavior] restOrSleep: dead -> rez, injured -> full, full -> already full", () => {
  const ent: any = { hp: 0, maxHp: 100, alive: false };
  const ctx = makeCtx(ent);

  // dead -> rez+full
  const deadMsg = restOrSleep(ctx);
  assert.equal(deadMsg, "You pull yourself back together and feel fully restored.");
  assert.equal(ent.hp, 100);
  assert.equal(ent.alive, true);

  // injured -> full restore
  ent.hp = 50;
  const injuredMsg = restOrSleep(ctx);
  assert.equal(injuredMsg, "You rest for a moment and feel fully restored.");
  assert.equal(ent.hp, 100);

  // full -> already full
  ent.hp = 100;
  const fullMsg = restOrSleep(ctx);
  assert.equal(fullMsg, "You are already at full health.");
  assert.equal(ent.hp, 100);
});
