// worldcore/test/contract_npcManager_packAssist_offenderWindow_scopedByCallerWhenNoGroup.test.ts
//
// Contract: PW_ASSIST_OFFENDER_WINDOW_MS is scoped by pack groupId when present.
// If a prototype has no groupId, we scope throttling per-caller so "undefined:<offender>"
// does not globally suppress unrelated NPCs.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";
import { updateThreatFromDamage, getThreatValue } from "../npc/NpcThreat";

test("[contract] npcManager: offender window is scoped per-caller when groupId is missing", () => {
  const realNow = Date.now;
  const oldEnv = {
    max: process.env.PW_ASSIST_MAX_ALLIES_PER_CALL,
    cd: process.env.PW_ASSIST_CALL_COOLDOWN_MS,
    win: process.env.PW_ASSIST_OFFENDER_WINDOW_MS,
    pct: process.env.PW_ASSIST_THREAT_SHARE_PCT,
    min: process.env.PW_ASSIST_THREAT_SHARE_MIN,
    maxShare: process.env.PW_ASSIST_THREAT_SHARE_MAX,
  };

  try {
    process.env.PW_ASSIST_MAX_ALLIES_PER_CALL = "1";
    process.env.PW_ASSIST_CALL_COOLDOWN_MS = "0";
    process.env.PW_ASSIST_OFFENDER_WINDOW_MS = "10000";
    process.env.PW_ASSIST_THREAT_SHARE_PCT = "0.5";
    process.env.PW_ASSIST_THREAT_SHARE_MIN = "1";
    process.env.PW_ASSIST_THREAT_SHARE_MAX = "50";

    Date.now = () => 1000;

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const offender = entities.createPlayerForSession("sess1", "prime_shard:0,0");

    // Use a prototype that can call help, but give it a custom id that is NOT in the prototype registry
    // and intentionally omit groupId.
    const base = DEFAULT_NPC_PROTOTYPES.bandit_caster;
    assert.ok(base, "Expected bandit_caster proto to exist");

    const proto: any = {
      ...base,
      id: "bandit_caster_nogroup_test",
      groupId: undefined,
      canCallHelp: true,
    };

    // Two "packs" in different rooms (both missing groupId) should NOT throttle each other.
    const roomA = "prime_shard:0,0";
    const roomB = "prime_shard:9,9";

    const leaderA = npcs.spawnNpc(proto, roomA, 0, 0, 0);
    const allyA = npcs.spawnNpc(proto, roomA, 1, 0, 0);

    const leaderB = npcs.spawnNpc(proto, roomB, 0, 0, 0);
    const allyB = npcs.spawnNpc(proto, roomB, 1, 0, 0);

    // Initialize tick clock
    npcs.updateAll(0);

    // Seed threat on both leaders so share becomes > 1.
    (npcs as any).npcThreat.set(
      leaderA.entityId,
      updateThreatFromDamage(undefined, offender.id, 30, 1000),
    );
    (npcs as any).npcThreat.set(
      leaderB.entityId,
      updateThreatFromDamage(undefined, offender.id, 30, 1000),
    );

    // First wave in roomA should assist allyA.
    (npcs as any).notifyPackAllies(offender.id, leaderA, proto, {
      snapAllies: false,
      tickNow: 1000,
    });

    assert.ok(
      getThreatValue((npcs as any).npcThreat.get(allyA.entityId), offender.id) > 0,
      "roomA ally should be assisted",
    );
    assert.equal(
      getThreatValue((npcs as any).npcThreat.get(allyB.entityId), offender.id),
      0,
      "roomB ally should not be touched by roomA wave",
    );

    // Remove the offender entity so the second wave does not get blocked by out_of_room validity
    // when cross-room assist is disabled. This keeps the contract focused on offender-window scoping.
    entities.removeEntity(offender.id);

    // Second wave from a different caller (roomB) within the window should still assist allyB.
    (npcs as any).notifyPackAllies(offender.id, leaderB, proto, {
      snapAllies: false,
      tickNow: 1500,
    });

    assert.ok(
      getThreatValue((npcs as any).npcThreat.get(allyB.entityId), offender.id) > 0,
      "roomB ally should still be assisted",
    );
  } finally {
    Date.now = realNow;

    if (oldEnv.max === undefined) delete process.env.PW_ASSIST_MAX_ALLIES_PER_CALL;
    else process.env.PW_ASSIST_MAX_ALLIES_PER_CALL = oldEnv.max;

    if (oldEnv.cd === undefined) delete process.env.PW_ASSIST_CALL_COOLDOWN_MS;
    else process.env.PW_ASSIST_CALL_COOLDOWN_MS = oldEnv.cd;

    if (oldEnv.win === undefined) delete process.env.PW_ASSIST_OFFENDER_WINDOW_MS;
    else process.env.PW_ASSIST_OFFENDER_WINDOW_MS = oldEnv.win;

    if (oldEnv.pct === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_PCT;
    else process.env.PW_ASSIST_THREAT_SHARE_PCT = oldEnv.pct;

    if (oldEnv.min === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MIN;
    else process.env.PW_ASSIST_THREAT_SHARE_MIN = oldEnv.min;

    if (oldEnv.maxShare === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MAX;
    else process.env.PW_ASSIST_THREAT_SHARE_MAX = oldEnv.maxShare;
  }
});
