// worldcore/test/contract_npcManager_taunt_usesTickNow.test.ts
//
// Contract: NpcManager.taunt must use the NpcManager tick clock (updateAll simulated time)
// when stamping threat.forcedUntil/lastTauntAt, rather than calling Date.now() inside applyTauntToThreat.
// This keeps taunt windows deterministic for tests and consistent with server tick time.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";

test("[contract] npcManager: taunt stamps threat using tick clock (not Date.now)", () => {
  const realNow = Date.now;

  try {
    // 1) Freeze Date.now so updateAll initializes the simulated clock to a known value.
    Date.now = () => 1000;

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const npc = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.town_rat, "prime_shard:0,0", 0, 0, 0);

    // Initialize tick clock
    npcs.updateAll(0);

    // 2) Now change Date.now to a totally different value. If taunt uses Date.now
    // inside applyTauntToThreat, forcedUntil will be based on this new value and the test will fail.
    Date.now = () => 999_999;

    const ok = npcs.taunt(npc.entityId, "taunter.1", { durationMs: 4000 });
    assert.equal(ok, true, "taunt should apply");

    const threat = (npcs as any).npcThreat.get(npc.entityId);
    assert.ok(threat, "npcThreat should exist");

    assert.equal(threat.forcedTargetEntityId, "taunter.1", "taunt should set forced target");
    assert.equal(threat.lastTauntAt, 1000, "lastTauntAt should be stamped using tick clock");
    assert.equal(threat.forcedUntil, 5000, "forcedUntil should be tickNow + durationMs");
  } finally {
    Date.now = realNow;
  }
});
