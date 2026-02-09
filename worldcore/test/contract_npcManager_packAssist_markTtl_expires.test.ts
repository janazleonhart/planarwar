// worldcore/test/contract_npcManager_packAssist_markTtl_expires.test.ts
//
// Contract: PW_ASSIST_MARK_TTL_MS expires per-(npc, offender) pack-help marks.
// Without a TTL, once an ally is marked as "already helped" against an offender,
// it can never be assisted again, even in long fights. With a TTL, pack help can
// recur after the mark expires, allowing extended encounters to behave naturally.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";
import { updateThreatFromDamage, getThreatValue } from "../npc/NpcThreat";

test("[contract] npcManager: pack-help marks expire with PW_ASSIST_MARK_TTL_MS", () => {
  const old = {
    ttl: process.env.PW_ASSIST_MARK_TTL_MS,
    max: process.env.PW_ASSIST_MAX_ALLIES_PER_CALL,
    cd: process.env.PW_ASSIST_CALL_COOLDOWN_MS,
    win: process.env.PW_ASSIST_OFFENDER_WINDOW_MS,
    pct: process.env.PW_ASSIST_THREAT_SHARE_PCT,
    min: process.env.PW_ASSIST_THREAT_SHARE_MIN,
    maxShare: process.env.PW_ASSIST_THREAT_SHARE_MAX,
  };

  try {
    process.env.PW_ASSIST_MARK_TTL_MS = "1000";
    process.env.PW_ASSIST_MAX_ALLIES_PER_CALL = "1";
    process.env.PW_ASSIST_CALL_COOLDOWN_MS = "0";
    process.env.PW_ASSIST_OFFENDER_WINDOW_MS = "0";
    process.env.PW_ASSIST_THREAT_SHARE_PCT = "0.5";
    process.env.PW_ASSIST_THREAT_SHARE_MIN = "1";
    process.env.PW_ASSIST_THREAT_SHARE_MAX = "50";

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const room = "prime_shard:0,0";
    const offender = entities.createPlayerForSession("sess_off", room);

    const proto = DEFAULT_NPC_PROTOTYPES.bandit_caster;
    assert.ok(proto && proto.canCallHelp, "bandit_caster proto should exist and canCallHelp");

    const leader = npcs.spawnNpc(proto as any, room, 0, 0, 0);
    const ally = npcs.spawnNpc(proto as any, room, 1, 0, 0);

    // init tick clock
    npcs.updateAll(0);

    // Seed threat on leader so sharedThreat becomes > 1 (ceil(20*0.5)=10)
    (npcs as any).npcThreat.set(
      leader.entityId,
      updateThreatFromDamage(undefined, offender.id, 20, 1000),
    );

    // Wave 1 at t=1000: ally must be assisted
    (npcs as any).notifyPackAllies(offender.id, leader, proto as any, {
      snapAllies: false,
      tickNow: 1000,
    });

    const t1 = getThreatValue((npcs as any).npcThreat.get(ally.entityId), offender.id);
    assert.ok(t1 > 0, "ally should be assisted in first wave");

    // Wave 2 at t=1500 (< TTL): mark should still block re-assist (threat should not increase)
    (npcs as any).notifyPackAllies(offender.id, leader, proto as any, {
      snapAllies: false,
      tickNow: 1500,
    });

    const t2 = getThreatValue((npcs as any).npcThreat.get(ally.entityId), offender.id);
    assert.equal(t2, t1, "ally should not be re-assisted before TTL expires");

    // Wave 3 at t=2501 (> TTL): mark should expire, allow re-assist (threat increases)
    (npcs as any).notifyPackAllies(offender.id, leader, proto as any, {
      snapAllies: false,
      tickNow: 2501,
    });

    const t3 = getThreatValue((npcs as any).npcThreat.get(ally.entityId), offender.id);
    assert.ok(t3 > t2, "ally should be re-assisted after TTL expires");
  } finally {
    if (old.ttl === undefined) delete process.env.PW_ASSIST_MARK_TTL_MS;
    else process.env.PW_ASSIST_MARK_TTL_MS = old.ttl;

    if (old.max === undefined) delete process.env.PW_ASSIST_MAX_ALLIES_PER_CALL;
    else process.env.PW_ASSIST_MAX_ALLIES_PER_CALL = old.max;

    if (old.cd === undefined) delete process.env.PW_ASSIST_CALL_COOLDOWN_MS;
    else process.env.PW_ASSIST_CALL_COOLDOWN_MS = old.cd;

    if (old.win === undefined) delete process.env.PW_ASSIST_OFFENDER_WINDOW_MS;
    else process.env.PW_ASSIST_OFFENDER_WINDOW_MS = old.win;

    if (old.pct === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_PCT;
    else process.env.PW_ASSIST_THREAT_SHARE_PCT = old.pct;

    if (old.min === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MIN;
    else process.env.PW_ASSIST_THREAT_SHARE_MIN = old.min;

    if (old.maxShare === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MAX;
    else process.env.PW_ASSIST_THREAT_SHARE_MAX = old.maxShare;
  }
});
