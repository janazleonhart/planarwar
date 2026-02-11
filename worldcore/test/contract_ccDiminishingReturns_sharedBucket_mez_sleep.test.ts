//worldcore/test/contract_ccDiminishingReturns_sharedBucket_mez_sleep.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffect, clearAllStatusEffects } from "../combat/StatusEffects";

function makeChar(id: string): any {
  return {
    id,
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

test("[contract] CC diminishing returns: mez and sleep share a bucket when configured", () => {
  process.env.PW_CC_DR_ENABLED = "true";
  process.env.PW_CC_DR_WINDOW_MS = "18000";
  process.env.PW_CC_DR_TAGS = "mez,sleep";
  process.env.PW_CC_DR_MULTS = "1,0.5,0.25";
  process.env.PW_CC_DR_BUCKETS = "cc=mez,sleep";

  const c = makeChar("c");
  clearAllStatusEffects(c);

  const now1 = 1000;
  const inst1 = applyStatusEffect(
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

  assert.equal(inst1.expiresAtMs - now1, 10_000);

  // Sleep is in the same bucket, so it should advance stage.
  const now2 = 2000;
  const inst2 = applyStatusEffect(
    c,
    {
      id: "sleep_a",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "sleep"],
    },
    now2,
  );

  assert.equal(inst2.expiresAtMs - now2, 5_000);
});
