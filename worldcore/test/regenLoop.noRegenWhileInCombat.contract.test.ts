import test from "node:test";
import assert from "node:assert/strict";

test("[contract] regen loop does not regen while inCombatUntil is in the future", async () => {
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

    const ent: any = {
      id: "ent-combat",
      type: "player",
      hp: 50,
      maxHp: 100,
      alive: true,
      inCombatUntil: Date.now() + 60_000,
    };

    const ctx: any = {
      sessions: { getAllSessions: () => [{ id: "sess1" }] },
      entities: { getEntityByOwner: () => ent },
    };

    ensureRegenLoop(ctx);

    assert.ok(tick, "Expected ensureRegenLoop to install a regen interval callback");

    const before = ent.hp;
    (tick as any)();
    assert.equal(ent.hp, before, "In-combat entity must not regen");
  } finally {
    globalThis.setInterval = realSetInterval;
  }
});
