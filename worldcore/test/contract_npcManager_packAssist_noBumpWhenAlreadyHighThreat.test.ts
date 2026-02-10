// worldcore/test/contract_npcManager_packAssist_noBumpWhenAlreadyHighThreat.test.ts
//
// Contract: optional anti-jitter knob PW_ASSIST_MIN_THREAT_DELTA_TO_BUMP prevents repeated
// pack-assist seeds from inflating threat when an ally is already heavily engaged with the offender.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { getNpcPrototype } from "../npc/NpcTypes";
import { getThreatValue, updateThreatFromDamage } from "../npc/NpcThreat";


test("[contract] npcManager: pack assist does not bump threat when ally already has high threat", () => {
  const oldDelta = process.env.PW_ASSIST_MIN_THREAT_DELTA_TO_BUMP;
  const oldPct = process.env.PW_ASSIST_THREAT_SHARE_PCT;
  const oldMin = process.env.PW_ASSIST_THREAT_SHARE_MIN;
  const oldMax = process.env.PW_ASSIST_THREAT_SHARE_MAX;

  try {
    process.env.PW_ASSIST_MIN_THREAT_DELTA_TO_BUMP = "0";
    process.env.PW_ASSIST_THREAT_SHARE_PCT = "0.5";
    process.env.PW_ASSIST_THREAT_SHARE_MIN = "1";
    process.env.PW_ASSIST_THREAT_SHARE_MAX = "999";

    const ROOM = "prime_shard:0,0";
    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const offender = entities.createPlayerForSession("sess-offender", ROOM) as any;

    const leader = npcs.spawnNpcById("bandit_caster", ROOM, 0, 0, 0);
    const ally = npcs.spawnNpcById("bandit_caster", ROOM, 1, 0, 0);
    assert.ok(leader && ally, "leader+ally should spawn");

    npcs.updateAll(0);

    const st = npcs.listNpcsInRoom(ROOM).find((n) => n.entityId === leader.entityId);
    assert.ok(st, "leader runtime state should exist");
    const proto = getNpcPrototype(st!.templateId) ?? getNpcPrototype(st!.protoId);
    assert.ok(proto, "leader prototype should resolve");

    // Caller has moderate threat on offender (baseThreat=30) -> sharedThreat=ceil(30*0.5)=15.
    (npcs as any).npcThreat.set(
      leader.entityId,
      updateThreatFromDamage(undefined, offender.id, 30, 900),
    );

    // Ally already has very high threat on offender.
    (npcs as any).npcThreat.set(
      ally.entityId,
      updateThreatFromDamage(undefined, offender.id, 99, 900),
    );

    const before = getThreatValue((npcs as any).npcThreat.get(ally.entityId), offender.id);
    assert.equal(before, 99, "sanity: ally threat starts at 99");

    (npcs as any).notifyPackAllies(offender.id, st!, proto!, {
      snapAllies: false,
      tickNow: 1000,
    });

    const after = getThreatValue((npcs as any).npcThreat.get(ally.entityId), offender.id);
    assert.equal(after, 99, "ally threat should not be bumped by assist seed when already high");
  } finally {
    if (oldDelta === undefined) delete process.env.PW_ASSIST_MIN_THREAT_DELTA_TO_BUMP;
    else process.env.PW_ASSIST_MIN_THREAT_DELTA_TO_BUMP = oldDelta;

    if (oldPct === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_PCT;
    else process.env.PW_ASSIST_THREAT_SHARE_PCT = oldPct;

    if (oldMin === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MIN;
    else process.env.PW_ASSIST_THREAT_SHARE_MIN = oldMin;

    if (oldMax === undefined) delete process.env.PW_ASSIST_THREAT_SHARE_MAX;
    else process.env.PW_ASSIST_THREAT_SHARE_MAX = oldMax;
  }
});
