//worldcore/test/contract_ccDiminishingReturns_mez.test.ts

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

test("[contract] CC diminishing returns: repeated mez shortens duration within window", () => {
  process.env.PW_CC_DR_ENABLED = "true";
  process.env.PW_CC_DR_WINDOW_MS = "18000";
  process.env.PW_CC_DR_TAGS = "mez";
  process.env.PW_CC_DR_MULTS = "1,0.5,0.25";

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

  const now2 = 2000;
  const inst2 = applyStatusEffect(
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

  assert.equal(inst2.expiresAtMs - now2, 5_000);
});

test("[contract] CC diminishing returns: window expiry resets stage", () => {
  process.env.PW_CC_DR_ENABLED = "true";
  process.env.PW_CC_DR_WINDOW_MS = "18000";
  process.env.PW_CC_DR_TAGS = "mez";
  process.env.PW_CC_DR_MULTS = "1,0.5,0.25";

  const c = makeChar("c");
  clearAllStatusEffects(c);

  const now1 = 1000;
  applyStatusEffect(
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

  // Stage increments, so this one would be halved.
  const now2 = 2000;
  const inst2 = applyStatusEffect(
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
  assert.equal(inst2.expiresAtMs - now2, 5_000);

  // After window, stage resets back to full.
  // Window is measured from the most recent CC application (now2).
  const now3 = now2 + 18_000 + 1;
  const inst3 = applyStatusEffect(
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

  assert.equal(inst3.expiresAtMs - now3, 10_000);
});
