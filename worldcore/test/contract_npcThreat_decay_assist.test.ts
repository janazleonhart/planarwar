// worldcore/test/contract_npcThreat_decay_assist.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTauntToThreat,
  decayThreat,
  getAssistTargetForAlly,
  getTopThreatTarget,
  getThreatValue,
  updateThreatFromDamage,
} from "../npc/NpcThreat";

test("[contract] NpcThreat: decayThreat subtracts linearly and prunes buckets deterministically", () => {
  const t0 = 1_000_000;

  // A=5, B=1
  let threat = updateThreatFromDamage(undefined, "A", 5, t0);
  threat = updateThreatFromDamage(threat, "B", 1, t0);

  // After 2 seconds at 2 threat/sec, A=1, B pruned.
  const t1 = t0 + 2000;
  const decayed = decayThreat(threat, { now: t1, decayPerSec: 2, pruneBelow: 0 })!;

  assert.equal(Math.round(getThreatValue(decayed, "A")), 1, "A should decay from 5 to ~1");
  assert.equal(getThreatValue(decayed, "B"), 0, "B should be pruned to 0");
  assert.equal(getTopThreatTarget(decayed, t1), "A", "top threat should remain A");

  // After 1 more second, A prunes as well.
  const t2 = t1 + 1000;
  const decayed2 = decayThreat(decayed, { now: t2, decayPerSec: 2, pruneBelow: 0 })!;
  assert.equal(getTopThreatTarget(decayed2, t2), decayed2.lastAttackerEntityId, "fallback to lastAttacker when table empty");
});

test("[contract] NpcThreat: assist target requires fresh aggro window + minimum top threat", () => {
  const t0 = 2_000_000;

  // Ally is fighting X with meaningful threat.
  let ally = updateThreatFromDamage(undefined, "X", 3, t0);

  const assist = getAssistTargetForAlly(ally, t0 + 1000, { windowMs: 5000, minTopThreat: 2 });
  assert.equal(assist, "X", "should assist ally against X");

  // If threat too small, no assist.
  ally = updateThreatFromDamage(undefined, "X", 1, t0);
  const noAssistLow = getAssistTargetForAlly(ally, t0 + 1000, { windowMs: 5000, minTopThreat: 2 });
  assert.equal(noAssistLow, undefined);

  // If stale, no assist.
  const noAssistStale = getAssistTargetForAlly(ally, t0 + 6000, { windowMs: 5000, minTopThreat: 1 });
  assert.equal(noAssistStale, undefined);

  // Forced target takes priority if active.
  ally = updateThreatFromDamage(undefined, "X", 10, t0);
  ally = updateThreatFromDamage(ally, "Y", 10, t0);
  const taunted = applyTauntToThreat(ally, "Y", { now: t0, durationMs: 4000, threatBoost: 0 });
  const assistForced = getAssistTargetForAlly(taunted, t0 + 100, { windowMs: 5000, minTopThreat: 1 });
  assert.equal(assistForced, "Y", "should assist forced/taunt target while active");
});
