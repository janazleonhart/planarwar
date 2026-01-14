import test from "node:test";
import assert from "node:assert/strict";

test("[contract] ensureRegenLoop is idempotent (does not create multiple timers)", async () => {
  const realSetInterval = globalThis.setInterval;

  let calls = 0;
  let lastFn: any = null;

  try {
    (globalThis as any).setInterval = (fn: any, _ms: any) => {
      calls++;
      lastFn = fn;
      return 999 as any;
    };

    const mod: any = await import("../systems/regen/ensureRegenLoop");
    const ensureRegenLoop: any = mod.ensureRegenLoop ?? mod.default;

    assert.equal(typeof ensureRegenLoop, "function", "ensureRegenLoop export not found");

    const ent: any = { id: "e1", type: "player", hp: 50, maxHp: 100, alive: true, inCombatUntil: 0 };

    const ctx: any = {
      sessions: { getAllSessions: () => [{ id: "sess1" }] },
      entities: { getEntityByOwner: () => ent },
    };

    ensureRegenLoop(ctx);
    ensureRegenLoop(ctx);
    ensureRegenLoop(ctx);

    assert.ok(lastFn, "Expected ensureRegenLoop to install a regen interval callback");
    assert.equal(calls, 1, "ensureRegenLoop must only install one interval (idempotent)");

    // sanity: tick still works
    const before = ent.hp;
    (lastFn as any)();
    assert.ok(ent.hp >= before, "tick should not decrease hp");
  } finally {
    globalThis.setInterval = realSetInterval;
  }
});
