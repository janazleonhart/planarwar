// worldcore/test/contract_npcManager_healThreat_appliesToEngagedNpcs.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { getThreatValue } from "../npc/NpcThreat";

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("[contract] NpcManager: healing generates threat on NPCs already engaged with healed/healer (same room)", () => {
  withEnv({ PW_THREAT_HEAL_MULT: "2" }, () => {
    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const roomId = "room:1";
    const healerEnt = entities.createPlayerForSession("sess.healer", roomId) as any;
    const healedEnt = entities.createPlayerForSession("sess.healed", roomId) as any;

    const npc = npcs.spawnNpcById("training_dummy", roomId, 0, 0, 0);
    assert.ok(npc, "npc should spawn");

    // NPC is engaged with the healed target.
    npcs.recordDamage((npc as any).entityId, healedEnt.id, 10);

    // A big heal should generate a larger threat spike for the healer.
    npcs.recordHealing(roomId, healerEnt.id, healedEnt.id, 20, 1000);

    const st = npcs.getThreatState((npc as any).entityId);
    assert.ok(st, "npc threat state should exist");

    // healThreat = floor(20 * 2) = 40
    assert.equal(getThreatValue(st as any, healerEnt.id), 40);
    assert.equal(getThreatValue(st as any, healedEnt.id), 10);
  });
});
