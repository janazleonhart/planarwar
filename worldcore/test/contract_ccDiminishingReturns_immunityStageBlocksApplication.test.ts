//worldcore/test/contract_ccDiminishingReturns_immunityStageBlocksApplication.test.ts

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

test("[contract] CC diminishing returns: immunity stage blocks application", () => {
  process.env.PW_CC_DR_ENABLED = "true";
  process.env.PW_CC_DR_WINDOW_MS = "18000";
  process.env.PW_CC_DR_TAGS = "mez";
  process.env.PW_CC_DR_MULTS = "1,0.5,0";

  const c = makeChar("c");
  clearAllStatusEffects(c);

  const now1 = 1000;
  const a1 = applyStatusEffect(
    c,
    {
      id: "mez_a",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "mez"],
    },
    now1,
  );
  assert.equal((a1 as any).wasApplied ?? true, true);

  const now2 = 2000;
  const a2 = applyStatusEffect(
    c,
    {
      id: "mez_b",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "mez"],
    },
    now2,
  );
  assert.equal(a2.expiresAtMs - now2, 5_000);

  // Third application within the window should be immune (mult=0).
  const now3 = 3000;
  const a3 = applyStatusEffect(
    c,
    {
      id: "mez_c",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "mez"],
    },
    now3,
  );

  assert.equal((a3 as any).wasApplied, false);
  assert.equal((a3 as any).blockedReason, "cc_dr_immune");

  const active = getActiveStatusEffects(c, now3);
  // Only the first two should be stored.
  assert.equal(active.filter((e: any) => String(e.id).startsWith("mez_")).length, 2);
});
