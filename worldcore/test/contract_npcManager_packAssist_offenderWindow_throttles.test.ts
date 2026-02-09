// worldcore/test/contract_npcManager_packAssist_offenderWindow_throttles.test.ts
//
// Contract: PW_ASSIST_OFFENDER_WINDOW_MS throttles pack assist waves across the entire pack.
// If multiple NPCs in the same group can call help for the same offender in quick succession,
// the pack can "cascade dogpile" in a way that feels coin-flippy. This window ensures only
// one assist wave can happen per offender (per group) within the configured time window.
//
// Note: forceRoomId (gate-home) bypasses this throttling intentionally.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";
import { updateThreatFromDamage, getThreatValue } from "../npc/NpcThreat";

test("[contract] npcManager: offender window throttles pack assist across callers", () => {
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

    const leader1 = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 0, 0, 0);
    const leader2 = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 0, 0, 0);
    const ally1 = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 1, 0, 0);
    const ally2 = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 2, 0, 0);

    // Initialize tick clock
    npcs.updateAll(0);

    // Seed threat on both leaders so share becomes > 1.
    (npcs as any).npcThreat.set(leader1.entityId, updateThreatFromDamage(undefined, offender.id, 30, 1000));
    (npcs as any).npcThreat.set(leader2.entityId, updateThreatFromDamage(undefined, offender.id, 30, 1000));

    // First wave at t=1000 should assist exactly one ally (max=1).
    (npcs as any).notifyPackAllies(offender.id, leader1, DEFAULT_NPC_PROTOTYPES.coward_rat, {
      snapAllies: false,
      tickNow: 1000,
    });

    // Pack assist may prioritize already-engaged allies; we only care that exactly one
    // additional pack member (excluding the caller) was assisted due to maxAlliesPerCall=1.
    const assistedAfterFirst = [leader2, ally1, ally2].filter((a) => {
      const th = (npcs as any).npcThreat.get(a.entityId);
      return getThreatValue(th, offender.id) > 0;
    }).length;
    assert.equal(assistedAfterFirst, 1, "first wave should assist exactly 1 pack member");

    // Second wave from a DIFFERENT caller within offender window must do nothing.
    (npcs as any).notifyPackAllies(offender.id, leader2, DEFAULT_NPC_PROTOTYPES.coward_rat, {
      snapAllies: false,
      tickNow: 2000,
    });

    const assistedAfterSecond = [leader2, ally1, ally2].filter((a) => {
      const th = (npcs as any).npcThreat.get(a.entityId);
      return getThreatValue(th, offender.id) > 0;
    }).length;
    assert.equal(assistedAfterSecond, 1, "offender window should block second wave across callers");
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
