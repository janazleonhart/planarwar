// worldcore/test/contract_ccImmunityBlocksCcApplication.test.ts

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

test("[contract] CC immunity tag blocks CC application", () => {
  // Ensure the default CC tag list includes mez.
  delete process.env.PW_CC_DR_TAGS;

  const c = makeChar("c");
  clearAllStatusEffects(c);

  const now1 = 1000;
  const imm = applyStatusEffect(
    c,
    {
      id: "cc_immunity_aura",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 60_000,
      modifiers: {},
      tags: ["buff", "cc_immune"],
    },
    now1,
  );
  assert.equal((imm as any).wasApplied ?? true, true);

  const now2 = 2000;
  const mez = applyStatusEffect(
    c,
    {
      id: "mez_x",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "mez"],
    },
    now2,
  );

  assert.equal((mez as any).wasApplied, false);
  assert.equal((mez as any).blockedReason, "cc_immune");

  const active = getActiveStatusEffects(c, now2);
  assert.equal(active.some((e: any) => e.id === "mez_x"), false);
  assert.equal(active.some((e: any) => e.id === "cc_immunity_aura"), true);
});
