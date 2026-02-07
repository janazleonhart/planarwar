// worldcore/test/contract_npcThreat_selectTarget_filtersInvalidForced.test.ts
//
// Contract: the selector used by NPC brains must not "stick" to an invalid
// forced target (e.g., stealth / out-of-room). When the forced target is invalid,
// the forced window is cleared and selection falls back to the best valid threat.

import test from "node:test";
import assert from "node:assert/strict";

import { selectThreatTarget, type NpcThreatState } from "../npc/NpcThreat";

test("[contract] npcThreat: invalid forced target is cleared and selector falls back", () => {
  const now = 100_000;

  const threat: NpcThreatState = {
    threatByEntityId: { stealthy: 10, visible: 5 },
    lastAttackerEntityId: "stealthy",
    lastAggroAt: now - 100,
    forcedTargetEntityId: "stealthy",
    forcedUntil: now + 4000,
  };

  const sel = selectThreatTarget(threat, now, (id) => id !== "stealthy");
  assert.equal(sel.targetId, "visible", "selector should skip invalid forced target and choose next best");
  assert.ok(sel.nextThreat, "selector should return nextThreat");
  assert.ok(!sel.nextThreat?.forcedTargetEntityId, "forced target should be cleared when invalid");
  assert.ok(!sel.nextThreat?.forcedUntil, "forced until should be cleared when invalid");
});
