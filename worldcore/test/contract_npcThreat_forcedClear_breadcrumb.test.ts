// worldcore/test/contract_npcThreat_forcedClear_breadcrumb.test.ts
//
// Contract: when a forced target becomes invalid (stealth/out-of-room/dead/etc),
// selectThreatTarget() clears the forced window AND preserves a breadcrumb so
// debug tooling can explain why the NPC swapped targets.

import test from "node:test";
import assert from "node:assert/strict";

import { selectThreatTarget, type NpcThreatState } from "../npc/NpcThreat";

test("[contract] npcThreat: clearing invalid forced target leaves breadcrumb", () => {
  const now = 100_000;

  const threat: NpcThreatState = {
    threatByEntityId: { stealthy: 10, visible: 5 },
    lastAttackerEntityId: "stealthy",
    lastAggroAt: now - 100,
    forcedTargetEntityId: "stealthy",
    forcedUntil: now + 4000,
  };

  const sel = selectThreatTarget(threat, now, (id) => {
    if (id === "stealthy") return { ok: false, reason: "stealth" };
    return { ok: true };
  });

  assert.equal(sel.targetId, "visible");
  assert.ok(sel.nextThreat);
  assert.equal(sel.nextThreat?.forcedClearedAt, now);
  assert.equal(sel.nextThreat?.forcedClearedReason, "stealth");
  assert.equal(sel.nextThreat?.forcedClearedTargetEntityId, "stealthy");
});
