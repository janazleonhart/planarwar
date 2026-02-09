// worldcore/test/contract_npcThreat_stickySwitch_margin.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { addThreatValue, selectThreatTarget, type NpcThreatState } from "../npc/NpcThreat";

test("[contract] NpcThreat: target stickiness prevents tiny threat lead swaps inside window", () => {
  const t0 = 1_000_000;

  // Seed: B slightly higher, so initial pick is B.
  let threat: NpcThreatState | undefined = undefined;
  threat = addThreatValue(threat, "A", 10, t0, { setLastAttacker: true, lastAttackerEntityId: "A" });
  threat = addThreatValue(threat, "B", 11, t0, { setLastAttacker: true, lastAttackerEntityId: "B" });

  // Initial selection picks B and records it as lastSelected.
  const sel0 = selectThreatTarget(threat, t0, () => ({ ok: true }));
  assert.equal(sel0.targetId, "B");
  const after0 = sel0.nextThreat!;
  assert.equal((after0 as any).lastSelectedTargetEntityId, "B");

  // Within sticky window, give A a tiny lead (should NOT flip).
  const t1 = t0 + 1000;
  let threat1 = addThreatValue(after0, "A", 0.4, t1, { setLastAttacker: true, lastAttackerEntityId: "A" });
  const sel1 = selectThreatTarget(threat1, t1, () => ({ ok: true }));
  assert.equal(sel1.targetId, "B", "should remain on previous target when lead is tiny");

  // Still within window, give A a decisive lead (should flip).
  const t2 = t0 + 1500;
  let threat2 = addThreatValue(sel1.nextThreat, "A", 10, t2, { setLastAttacker: true, lastAttackerEntityId: "A" });
  const sel2 = selectThreatTarget(threat2, t2, () => ({ ok: true }));
  assert.equal(sel2.targetId, "A", "should switch when challenger clears margin threshold");
});

test("[contract] NpcThreat: stickiness expires, allowing normal top-threat selection", () => {
  const t0 = 2_000_000;

  let threat: NpcThreatState | undefined = undefined;
  threat = addThreatValue(threat, "A", 10, t0, { setLastAttacker: true, lastAttackerEntityId: "A" });
  threat = addThreatValue(threat, "B", 11, t0, { setLastAttacker: true, lastAttackerEntityId: "B" });

  const sel0 = selectThreatTarget(threat, t0, () => ({ ok: true }));
  assert.equal(sel0.targetId, "B");

  // Make A slightly higher, but wait beyond sticky window.
  const tLate = t0 + 6000;
  const bumped = addThreatValue(sel0.nextThreat, "A", 2, tLate, { setLastAttacker: true, lastAttackerEntityId: "A" });
  const selLate = selectThreatTarget(bumped, tLate, () => ({ ok: true }));
  assert.equal(selLate.targetId, "A", "after window expiry, should pick top threat normally");
});
