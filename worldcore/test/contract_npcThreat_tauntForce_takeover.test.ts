// worldcore/test/contract_npcThreat_tauntForce_takeover.test.ts
//
// Contract: when taunt is used in "force takeover" mode, it should both force
// the current target briefly AND make the taunter become actual top threat.
//
// This contract is on the pure NpcThreat helper so brains/combat code can rely
// on deterministic semantics.

import test from "node:test";
import assert from "node:assert/strict";

import {
  updateThreatFromDamage,
  applyTauntToThreat,
  getTopThreatTarget,
  getThreatValue,
} from "../npc/NpcThreat";

test("[contract] taunt forceTakeover makes taunter become top threat", () => {
  const A = "ent-a";
  const B = "ent-b";

  let st: any = undefined;

  // A is clearly top threat.
  st = updateThreatFromDamage(st, A, 10, 1000);
  st = updateThreatFromDamage(st, B, 1, 1100);

  assert.equal(getTopThreatTarget(st, 1200), A);

  // B taunts with force takeover.
  st = applyTauntToThreat(st, B, { now: 2000, durationMs: 1000, threatBoost: 1, forceTakeover: true });

  assert.equal(getTopThreatTarget(st, 2500), B, "forced target should be B during taunt window");

  // After expiry, B should remain top threat because takeover boosted its bucket.
  assert.ok(getThreatValue(st, B) > getThreatValue(st, A), "taunter should become actual top threat");
  assert.equal(getTopThreatTarget(st, 3001), B, "after taunt expiry, top threat remains the taunter");
});
