// worldcore/test/contract_npcManager_packAssist_noCrossRoomWithoutTrain.test.ts
//
// Contract: pack assist must NOT seed threat across rooms unless cross-room assist is enabled
// (Train rooms) or the caller explicitly forces a room (gate-home help).
//
// This prevents NPCs from "radar" assisting through walls when the offender is out of room.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { getNpcPrototype } from "../npc/NpcTypes";
import { getThreatValue } from "../npc/NpcThreat";

test("[contract] npcManager: pack assist does not cross rooms without Train rooms", () => {
  const oldTrainEnabled = process.env.PW_TRAIN_ENABLED;
  const oldTrainRooms = process.env.PW_TRAIN_ROOMS_ENABLED;

  try {
    process.env.PW_TRAIN_ENABLED = "0";
    process.env.PW_TRAIN_ROOMS_ENABLED = "0";

    const ROOM_A = "assist-room-a";
    const ROOM_B = "assist-room-b";

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const attacker = entities.createPlayerForSession("sess-attacker", ROOM_B) as any;

    const leader = npcs.spawnNpcById("bandit_caster", ROOM_A, 0, 0, 0);
    const ally = npcs.spawnNpcById("bandit_caster", ROOM_A, 1, 0, 0);
    assert.ok(leader && ally, "leader+ally should spawn");

    // Ensure tick clock initialized.
    npcs.updateAll(0);

    const st = npcs.listNpcsInRoom(ROOM_A).find((n) => n.entityId === leader.entityId);
    assert.ok(st, "leader runtime state should exist");
    const proto =
      getNpcPrototype(st!.templateId) ??
      getNpcPrototype(st!.protoId);
    assert.ok(proto, "leader prototype should resolve");

    // Directly invoke pack assist (private) with snap enabled and no forceRoomId.
    (npcs as any).notifyPackAllies(attacker.id, st!, proto!, {
      snapAllies: true,
      tickNow: 1000,
    });

    // Ally should NOT move to ROOM_B and should NOT receive threat on attacker.
    assert.ok(
      npcs.listNpcsInRoom(ROOM_A).some((n) => n.entityId === ally.entityId),
      "ally should remain in ROOM_A",
    );
    assert.ok(
      !npcs.listNpcsInRoom(ROOM_B).some((n) => n.entityId === ally.entityId),
      "ally should not snap to ROOM_B",
    );

    const allyThreat = (npcs as any).npcThreat.get(ally.entityId);
    const v = getThreatValue(allyThreat, attacker.id);
    assert.equal(v, 0, "ally threat should not seed across rooms");
  } finally {
    if (oldTrainEnabled === undefined) delete process.env.PW_TRAIN_ENABLED;
    else process.env.PW_TRAIN_ENABLED = oldTrainEnabled;

    if (oldTrainRooms === undefined) delete process.env.PW_TRAIN_ROOMS_ENABLED;
    else process.env.PW_TRAIN_ROOMS_ENABLED = oldTrainRooms;
  }
});
