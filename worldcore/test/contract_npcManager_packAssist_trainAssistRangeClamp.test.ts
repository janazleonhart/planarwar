// worldcore/test/contract_npcManager_packAssist_trainAssistRangeClamp.test.ts
//
// Contract: when Train rooms are enabled, cross-room pack assist is distance-limited by
// PW_TRAIN_ASSIST_RANGE using room grid distance for canonical "shard:x,y" room ids.
//
// Far offender room -> no seed/snap
// Near offender room -> seed/snap

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { getNpcPrototype } from "../npc/NpcTypes";
import { getThreatValue } from "../npc/NpcThreat";

test("[contract] npcManager: Train assist range clamps cross-room pack assist", () => {
  const oldTrainEnabled = process.env.PW_TRAIN_ENABLED;
  const oldTrainRooms = process.env.PW_TRAIN_ROOMS_ENABLED;
  const oldAssistRange = process.env.PW_TRAIN_ASSIST_RANGE;

  try {
    process.env.PW_TRAIN_ENABLED = "1";
    process.env.PW_TRAIN_ROOMS_ENABLED = "1";
    process.env.PW_TRAIN_ASSIST_RANGE = "1";

    const ROOM_A = "prime_shard:0,0";
    const ROOM_FAR = "prime_shard:5,0";
    const ROOM_NEAR = "prime_shard:1,0";

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const attackerFar = entities.createPlayerForSession("sess-attacker-far", ROOM_FAR) as any;
    const attackerNear = entities.createPlayerForSession("sess-attacker-near", ROOM_NEAR) as any;

    const leader = npcs.spawnNpcById("bandit_caster", ROOM_A, 0, 0, 0);
    const ally = npcs.spawnNpcById("bandit_caster", ROOM_A, 1, 0, 0);
    assert.ok(leader && ally, "leader+ally should spawn");

    npcs.updateAll(0);

    const st = npcs.listNpcsInRoom(ROOM_A).find((n) => n.entityId === leader.entityId);
    assert.ok(st, "leader runtime state should exist");
    const proto = getNpcPrototype(st!.templateId) ?? getNpcPrototype(st!.protoId);
    assert.ok(proto, "leader prototype should resolve");

    // Far offender room: should NOT seed or snap.
    (npcs as any).notifyPackAllies(attackerFar.id, st!, proto!, {
      snapAllies: true,
      tickNow: 1000,
    });

    assert.ok(
      npcs.listNpcsInRoom(ROOM_A).some((n) => n.entityId === ally.entityId),
      "ally should remain in ROOM_A when offender room is too far",
    );
    assert.equal(
      getThreatValue((npcs as any).npcThreat.get(ally.entityId), attackerFar.id),
      0,
      "ally threat should not seed for far offender room",
    );

    // Near offender room: should seed and snap (ally moves to offender room).
    (npcs as any).notifyPackAllies(attackerNear.id, st!, proto!, {
      snapAllies: true,
      tickNow: 2000,
    });

    assert.ok(
      npcs.listNpcsInRoom(ROOM_NEAR).some((n) => n.entityId === ally.entityId),
      "ally should snap to ROOM_NEAR when offender room is within range",
    );
    assert.ok(
      getThreatValue((npcs as any).npcThreat.get(ally.entityId), attackerNear.id) > 0,
      "ally threat should seed for near offender room",
    );
  } finally {
    if (oldTrainEnabled === undefined) delete process.env.PW_TRAIN_ENABLED;
    else process.env.PW_TRAIN_ENABLED = oldTrainEnabled;

    if (oldTrainRooms === undefined) delete process.env.PW_TRAIN_ROOMS_ENABLED;
    else process.env.PW_TRAIN_ROOMS_ENABLED = oldTrainRooms;

    if (oldAssistRange === undefined) delete process.env.PW_TRAIN_ASSIST_RANGE;
    else process.env.PW_TRAIN_ASSIST_RANGE = oldAssistRange;
  }
});
