// worldcore/test/contract_npcManager_dotThreat_attribution.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { getThreatValue } from "../npc/NpcThreat";

test("[contract] NpcManager: DOT ticks attribute threat to attacker entity id", () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const roomId = "room:1";
  const attackerEnt = entities.createPlayerForSession("sess.attacker", roomId) as any;

  const npc = npcs.spawnNpcById("training_dummy", roomId, 0, 0, 0);
  assert.ok(npc, "npc should spawn");

  // Apply a DOT tick with explicit attacker. Threat attribution should be best-effort.
  npcs.applyDotDamage((npc as any).entityId, 5, { appliedByKind: "character", appliedById: "char" }, attackerEnt.id);

  const st = npcs.getThreatState((npc as any).entityId);
  assert.ok(st, "npc threat state should exist");
  assert.ok(getThreatValue(st as any, attackerEnt.id) > 0, "attacker should have non-zero threat");
});
