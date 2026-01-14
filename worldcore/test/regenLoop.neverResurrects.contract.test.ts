import test from "node:test";
import assert from "node:assert/strict";

test("[contract] regen loop never resurrects dead entities", async () => {
  // Capture the interval callback without waiting.
  const realSetInterval = globalThis.setInterval;

  let tick: any = null;

  try {
    (globalThis as any).setInterval = (fn: any, _ms: any) => {
      tick = fn;
      return 123 as any;
    };

    const mod: any = await import("../systems/regen/ensureRegenLoop");
    const ensureRegenLoop: any = mod.ensureRegenLoop ?? mod.default;

    assert.equal(typeof ensureRegenLoop, "function", "ensureRegenLoop export not found");

    // A dead entity: regen must never increase hp and must never flip alive=true.
    const ent: any = {
      id: "ent-dead",
      type: "player",
      hp: 0,
      maxHp: 100,
      alive: false,
      inCombatUntil: 0,
    };

    const ctx: any = {
      sessions: { getAllSessions: () => [{ id: "sess1" }] },
      entities: { getEntityByOwner: (_ownerId: string) => ent },
    };

    ensureRegenLoop(ctx);

    assert.ok(tick, "Expected ensureRegenLoop to install a regen interval callback");

    const beforeHp = ent.hp;
    const beforeAlive = ent.alive;

    (tick as any)();

    assert.equal(ent.hp, beforeHp, "Dead entity must not regen HP");
    assert.equal(ent.alive, beforeAlive, "Regen loop must not resurrect dead entity");
  } finally {
    globalThis.setInterval = realSetInterval;
  }
});
