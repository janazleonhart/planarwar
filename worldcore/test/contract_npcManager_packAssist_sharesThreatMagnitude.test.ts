// worldcore/test/contract_npcManager_packAssist_sharesThreatMagnitude.test.ts
//
// Contract: when an NPC calls pack help, allies should receive a share of the caller's
// current threat magnitude against the offender (not just a fixed +1), and timestamps
// should still use the NpcManager tick clock.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";
import { getThreatValue } from "../npc/NpcThreat";

test("[contract] npcManager: pack assist shares threat magnitude from caller", () => {
  const realNow = Date.now;
  const oldEnv = {
    pct: process.env.PW_ASSIST_THREAT_SHARE_PCT,
    min: process.env.PW_ASSIST_THREAT_SHARE_MIN,
    max: process.env.PW_ASSIST_THREAT_SHARE_MAX,
  };

  try {
    process.env.PW_ASSIST_THREAT_SHARE_PCT = "0.5";
    process.env.PW_ASSIST_THREAT_SHARE_MIN = "1";
    process.env.PW_ASSIST_THREAT_SHARE_MAX = "50";

    // Freeze base time for deterministic tick clock init.
    Date.now = () => 1000;

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const attacker = entities.createPlayerForSession("sess1", "prime_shard:0,0");

    const leader = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 0, 0, 0);
    const ally = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 1, 0, 0);

    // Initialize tick clock
    npcs.updateAll(0);

    // If pack assist uses Date.now internally, timestamps would be wrong.
    Date.now = () => 999_999;

    // Record a large threat event on the leader. Ally should receive 50% share => 15.
    npcs.recordDamage(leader.entityId, attacker.id, 30);

    const allyThreat = (npcs as any).npcThreat.get(ally.entityId);
    assert.ok(allyThreat, "ally threat should exist");

    assert.equal(allyThreat.lastAggroAt, 1000, "ally threat lastAggroAt should use tick clock");

    const v = getThreatValue(allyThreat, attacker.id);
    assert.equal(v, 15, "ally threat should seed to ceil(callerThreat * sharePct)");
  } finally {
    Date.now = realNow;

    if (oldEnv.pct === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_PCT;
    else process.env.PW_ASSIST_THREAT_SHARE_PCT = oldEnv.pct;

    if (oldEnv.min === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MIN;
    else process.env.PW_ASSIST_THREAT_SHARE_MIN = oldEnv.min;

    if (oldEnv.max === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MAX;
    else process.env.PW_ASSIST_THREAT_SHARE_MAX = oldEnv.max;
  }
});
