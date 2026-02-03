// worldcore/test/contract_npcThreat_tauntOverridesTopThreat.test.ts
//
// Contract: taunt forces the NPC's current target briefly, then threat resumes.
//
// This is a pure-function contract on NpcThreat so brains and combat code can
// rely on stable semantics without needing full world wiring.

import test from "node:test";
import assert from "node:assert/strict";

import {
  updateThreatFromDamage,
  applyTauntToThreat,
  getTopThreatTarget,
  getThreatValue,
} from "../npc/NpcThreat";

test("[contract] taunt forces target then expires back to top threat", () => {
  const A = "ent-a";
  const B = "ent-b";

  let st: any = undefined;

  // A does more damage than B -> A is top threat.
  st = updateThreatFromDamage(st, A, 10, 1000);
  st = updateThreatFromDamage(st, B, 5, 1100);

  assert.equal(getTopThreatTarget(st, 1200), A);
  assert.equal(getThreatValue(st, A), 10);
  assert.equal(getThreatValue(st, B), 5);

  // B taunts -> forced target B for 4s (default duration).
  st = applyTauntToThreat(st, B, { now: 2000, durationMs: 4000, threatBoost: 1 });

  assert.equal(getTopThreatTarget(st, 2500), B, "forced target should be B during taunt window");

  // After expiry, top threat should resume to A.
  assert.equal(getTopThreatTarget(st, 6501), A, "after taunt expiry, top threat resumes");
});
