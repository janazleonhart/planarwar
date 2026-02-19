// worldcore/test/contract_npcManager_petThreat_attribution.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { getThreatValue } from "../npc/NpcThreat";

test("[contract] NpcManager: pet damage generates threat on the pet entity id", () => {
  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  const roomId = "room:1";
  const ownerEnt = entities.createPlayerForSession("sess.owner", roomId) as any;
  const petEnt = entities.createPetEntity(roomId, "wolf", ownerEnt.id) as any;

  const npc = npcs.spawnNpcById("training_dummy", roomId, 0, 0, 0);
  assert.ok(npc, "npc should spawn");

  npcs.recordDamage((npc as any).entityId, petEnt.id, 7);

  const st = npcs.getThreatState((npc as any).entityId);
  assert.ok(st, "npc threat state should exist");
  assert.equal(getThreatValue(st as any, petEnt.id), 7);
});
