// worldcore/test/contract_npcManager_packAssist_maxAllies_prioritizesEngaged.test.ts
//
// Contract: pack assist should prioritize allies already engaged with the offender,
// and respect PW_ASSIST_MAX_ALLIES_PER_CALL.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";
import { getThreatValue, updateThreatFromDamage } from "../npc/NpcThreat";

test("[contract] npcManager: pack assist respects max-allies and prioritizes engaged allies", () => {
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
    process.env.PW_ASSIST_CALL_COOLDOWN_MS = "0";
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

    // Pre-engage ally2 with the offender so it should be prioritized, even though ally1 was spawned first.
    (npcs as any).npcThreat.set(
      ally2.entityId,
      updateThreatFromDamage(undefined, offender.id, 10, 1000),
    );

    // Seed leader threat so share becomes > 1.
    (npcs as any).npcThreat.set(
      leader.entityId,
      updateThreatFromDamage(undefined, offender.id, 30, 1000),
    );

    // Call pack help.
    (npcs as any).notifyPackAllies(offender.id, leader, DEFAULT_NPC_PROTOTYPES.coward_rat, {
      snapAllies: false,
      tickNow: 1000,
    });

    const th1 = (npcs as any).npcThreat.get(ally1.entityId);
    const th2 = (npcs as any).npcThreat.get(ally2.entityId);

    // Because max-allies=1, only ONE ally should receive the new shared threat tick.
    // And it should be the already-engaged ally2.
    const v1 = getThreatValue(th1, offender.id);
    const v2 = getThreatValue(th2, offender.id);

    assert.equal(v1, 0, "ally1 should not be assisted when max-allies=1");
    assert.ok(v2 > 0, "ally2 should be assisted (prioritized engaged ally)");
    assert.equal(
      (npcs as any).packHelpCalled.get(ally2.entityId)?.has(offender.id),
      true,
      "ally2 should be marked pack help",
    );
    assert.equal(
      (npcs as any).packHelpCalled.get(ally1.entityId)?.has(offender.id) ?? false,
      false,
      "ally1 should not be marked pack help",
    );
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
