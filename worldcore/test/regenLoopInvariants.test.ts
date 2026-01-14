// worldcore/test/regenLoopInvariants.test.ts
//
// Lane M1 (behavioral):
// - Dead entities do not regen.
// - In-combat entities do not regen.
// - Injured, out-of-combat entities regen by the tick amount.

import test from "node:test";
import assert from "node:assert/strict";

import { ensureRegenLoop } from "../systems/regen/ensureRegenLoop";

test("[behavior] regen loop respects dead + in-combat + injured rules", () => {
  // Capture the scheduled interval callback without waiting for real time.
  const realSetInterval = global.setInterval;

  let capturedCb: Function | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).setInterval = (cb: any, _ms: number) => {
    capturedCb = cb;
    return 1 as any;
  };

  try {
    const sessionId = "s1";

    const ent: any = {
      id: "p1",
      hp: 0,
      maxHp: 100,
      inCombatUntil: 0,
    };

    const ctx = {
      sessions: {
        getAllSessions() {
          return [{ id: sessionId }];
        },
      },
      entities: {
        getEntityByOwner(ownerId: string) {
          return ownerId === sessionId ? ent : null;
        },
      },
    };

    ensureRegenLoop(ctx as any);

    assert.ok(capturedCb, "Expected regen loop to schedule an interval callback");

    const tick = capturedCb as () => void;

    // 1) Dead -> no regen
    ent.hp = 0;
    ent.inCombatUntil = 0;
    tick();
    assert.equal(ent.hp, 0, "Dead entity must not regen");

    // 2) Alive but in combat -> no regen
    ent.hp = 50;
    ent.inCombatUntil = Date.now() + 60_000;
    tick();
    assert.equal(ent.hp, 50, "In-combat entity must not regen");

    // 3) Alive, out of combat, injured -> regen +2 (capped by max)
    ent.hp = 50;
    ent.inCombatUntil = 0;
    tick();
    assert.equal(ent.hp, 52, "Injured entity should regen by +2");

    // 4) Near max -> cap at maxHp
    ent.hp = 99;
    ent.inCombatUntil = 0;
    tick();
    assert.equal(ent.hp, 100, "Regen should cap at maxHp");

    // 5) Already full -> no change
    ent.hp = 100;
    ent.inCombatUntil = 0;
    tick();
    assert.equal(ent.hp, 100, "Full HP should not increase");
  } finally {
    global.setInterval = realSetInterval;
  }
});
