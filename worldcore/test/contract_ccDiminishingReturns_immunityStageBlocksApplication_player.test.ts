//worldcore/test/contract_ccDiminishingReturns_immunityStageBlocksApplication_player.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffect, clearAllStatusEffects, getActiveStatusEffects } from "../combat/StatusEffects";

function makeChar(id: string): any {
  return {
    id,
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

test("[contract] CC diminishing returns: immunity stage blocks application on players", () => {
  process.env.PW_CC_DR_ENABLED = "true";
  process.env.PW_CC_DR_WINDOW_MS = "18000";
  process.env.PW_CC_DR_TAGS = "mez";
  process.env.PW_CC_DR_MULTS = "1,0.5,0";

  const c = makeChar("c");
  clearAllStatusEffects(c);

  const now1 = 1000;
  const inst1 = applyStatusEffect(
    c,
    { id: "mez_a", sourceKind: "spell", sourceId: "test", durationMs: 10_000, modifiers: {}, tags: ["debuff", "mez"] },
    now1,
  );
  assert.equal(inst1.wasApplied ?? true, true);

  const now2 = 2000;
  const inst2 = applyStatusEffect(
    c,
    { id: "mez_b", sourceKind: "spell", sourceId: "test", durationMs: 10_000, modifiers: {}, tags: ["debuff", "mez"] },
    now2,
  );
  assert.equal(inst2.wasApplied ?? true, true);

  const activeBefore = getActiveStatusEffects(c, now2);
  assert.equal(activeBefore.length, 2);

  // Third application within the window hits immunity stage (mult=0) and should not be stored.
  const now3 = 3000;
  const inst3 = applyStatusEffect(
    c,
    { id: "mez_c", sourceKind: "spell", sourceId: "test", durationMs: 10_000, modifiers: {}, tags: ["debuff", "mez"] },
    now3,
  );

  assert.equal(inst3.wasApplied, false);
  assert.equal(inst3.blockedReason, "cc_dr_immune");

  const activeAfter = getActiveStatusEffects(c, now3);
  assert.equal(activeAfter.length, 2);
});
