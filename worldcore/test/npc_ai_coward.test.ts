import assert from "node:assert/strict";
import test from "node:test";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";

const ROOM_ID = "room-coward-test";

function createPlayer(entities: EntityManager): string {
  const player = entities.createPlayerForSession("session-coward", ROOM_ID);
  return player.id;
}

test("coward NPC flees after taking damage", () => {
  const entities = new EntityManager();
  const npcManager = new NpcManager(entities);

  const playerEntityId = createPlayer(entities);
  const coward = npcManager.spawnNpcById("coward_rat", ROOM_ID, 0, 0, 0);

  assert.ok(coward, "coward rat should spawn");
  const npcState = coward!;

  npcManager.applyDamage(npcState.entityId, 10);
  npcManager.recordDamage(npcState.entityId, playerEntityId);

  assert.ok(npcState.hp < npcState.maxHp, "coward should be wounded");

  npcManager.updateAll(500);

  assert.equal(npcState.fleeing, true, "coward should decide to flee");
  assert.equal(
    npcManager.getNpcStateByEntityId(npcState.entityId),
    undefined,
    "fleeing despawns coward",
  );
  assert.equal(
    entities.get(npcState.entityId),
    undefined,
    "entity manager should remove despawned coward",
  );
});
