// worldcore/test/contract_npcManager_packAssist_cooldown_throttles.test.ts
//
// Contract: PW_ASSIST_CALL_COOLDOWN_MS throttles repeated pack help calls from the
// same caller against the same offender. Without this, repeated calls can recruit
// the entire pack in quick succession, making fights feel "coin-flippy".

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";
import { updateThreatFromDamage, getThreatValue } from "../npc/NpcThreat";

test("[contract] npcManager: pack assist cooldown throttles repeated calls", () => {
  const realNow = Date.now;
  const oldEnv = {
    max: process.env.PW_ASSIST_MAX_ALLIES_PER_CALL,
    cd: process.env.PW_ASSIST_CALL_COOLDOWN_MS,
    pct: process.env.PW_ASSIST_THREAT_SHARE_PCT,
    min: process.env.PW_ASSIST_THREAT_SHARE_MIN,
    maxShare: process.env.PW_ASSIST_THREAT_SHARE_MAX,
  };

  try {
    process.env.PW_ASSIST_MAX_ALLIES_PER_CALL = "1";
    process.env.PW_ASSIST_CALL_COOLDOWN_MS = "10000";
    process.env.PW_ASSIST_THREAT_SHARE_PCT = "0.5";
    process.env.PW_ASSIST_THREAT_SHARE_MIN = "1";
    process.env.PW_ASSIST_THREAT_SHARE_MAX = "50";

    Date.now = () => 1000;

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const offender = entities.createPlayerForSession("sess1", "prime_shard:0,0");

    const leader = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 0, 0, 0);
    const ally1 = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 1, 0, 0);
    const ally2 = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 2, 0, 0);

    // Initialize tick clock
    npcs.updateAll(0);

    // Seed leader threat so share becomes > 1.
    (npcs as any).npcThreat.set(
      leader.entityId,
      updateThreatFromDamage(undefined, offender.id, 30, 1000),
    );

    // First call at t=1000 should assist exactly one ally (max=1).
    (npcs as any).notifyPackAllies(offender.id, leader, DEFAULT_NPC_PROTOTYPES.coward_rat, {
      snapAllies: false,
      tickNow: 1000,
    });

    const assistedAfterFirst = [ally1, ally2].filter((a) => {
      const th = (npcs as any).npcThreat.get(a.entityId);
      return getThreatValue(th, offender.id) > 0;
    }).length;

    assert.equal(assistedAfterFirst, 1, "first call should assist exactly 1 ally");

    // Second call within cooldown window should do nothing (should not assist a second ally).
    (npcs as any).notifyPackAllies(offender.id, leader, DEFAULT_NPC_PROTOTYPES.coward_rat, {
      snapAllies: false,
      tickNow: 2000,
    });

    const assistedAfterSecond = [ally1, ally2].filter((a) => {
      const th = (npcs as any).npcThreat.get(a.entityId);
      return getThreatValue(th, offender.id) > 0;
    }).length;

    assert.equal(assistedAfterSecond, 1, "second call within cooldown should not recruit another ally");
  } finally {
    Date.now = realNow;

    if (oldEnv.max === undefined) delete process.env.PW_ASSIST_MAX_ALLIES_PER_CALL;
    else process.env.PW_ASSIST_MAX_ALLIES_PER_CALL = oldEnv.max;

    if (oldEnv.cd === undefined) delete process.env.PW_ASSIST_CALL_COOLDOWN_MS;
    else process.env.PW_ASSIST_CALL_COOLDOWN_MS = oldEnv.cd;

    if (oldEnv.pct === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_PCT;
    else process.env.PW_ASSIST_THREAT_SHARE_PCT = oldEnv.pct;

    if (oldEnv.min === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MIN;
    else process.env.PW_ASSIST_THREAT_SHARE_MIN = oldEnv.min;

    if (oldEnv.maxShare === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MAX;
    else process.env.PW_ASSIST_THREAT_SHARE_MAX = oldEnv.maxShare;
  }
});
