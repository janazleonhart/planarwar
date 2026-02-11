// worldcore/test/contract_cleanseDispel_doesNotRemoveImmunityByDefault.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyStatusEffect,
  clearAllStatusEffects,
  clearStatusEffectsByTagsExDetailed,
  getActiveStatusEffects,
} from "../combat/StatusEffects";

function makeChar(id: string): any {
  return {
    id,
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

test("[contract] cleanse/dispel: immunity-tagged effects are protected by default", () => {
  const c = makeChar("c");
  clearAllStatusEffects(c);

  const now1 = 1000;
  applyStatusEffect(
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

  const now2 = 2000;
  const res = clearStatusEffectsByTagsExDetailed(
    c,
    ["cc_immune"],
    undefined,
    10,
    now2,
  );

  assert.equal(res.removed, 0);
  assert.equal(res.matched, 1);
  assert.equal(res.blockedByProtected, 1);

  const active = getActiveStatusEffects(c, now2);
  assert.equal(active.some((e: any) => e.id === "cc_immunity_aura"), true);
});
