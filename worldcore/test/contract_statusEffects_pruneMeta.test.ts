// worldcore/test/contract_statusEffects_pruneMeta.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffect, tickStatusEffects } from "../combat/StatusEffects";

/**
 * Contract: tickStatusEffects records prune metadata on the statusEffects state.
 *
 * Why: as we move more effects out-of-combat, we need introspection that doesn't
 * require logging spam. Meta is a cheap breadcrumb for debug tooling.
 */
test("[contract] StatusEffects: tickStatusEffects updates prune meta", () => {
  const t0 = 1_000_000;

  const char: any = {
    id: "char.1",
    name: "Tester",
    progression: {},
  };

  applyStatusEffect(
    char,
    {
      id: "meta_prune_test",
      sourceKind: "spell",
      sourceId: "test_meta_prune",
      name: "Meta Prune Test",
      durationMs: 1000,
      modifiers: {} as any,
    },
    t0,
  );

  // Not expired yet at exact boundary (strict '<' in prune).
  tickStatusEffects(char as any, t0 + 1000);
  const meta0 = char.progression.statusEffects?.meta;
  assert.equal(meta0?.lastTickAtMs, t0 + 1000);
  assert.equal(meta0?.lastPrunedCount ?? 0, 0);

  // Past expiry => prunes 1 instance.
  tickStatusEffects(char as any, t0 + 1500);
  const meta1 = char.progression.statusEffects?.meta;
  assert.equal(meta1?.lastTickAtMs, t0 + 1500);
  assert.equal(meta1?.lastPrunedCount, 1);
  assert.equal(meta1?.lastPruneAtMs, t0 + 1500);
  assert.equal(meta1?.totalPrunedCount, 1);

  // Next tick with nothing to prune should set lastPrunedCount=0 but keep total.
  tickStatusEffects(char as any, t0 + 1600);
  const meta2 = char.progression.statusEffects?.meta;
  assert.equal(meta2?.lastTickAtMs, t0 + 1600);
  assert.equal(meta2?.lastPrunedCount ?? 0, 0);
  assert.equal(meta2?.totalPrunedCount, 1);
});
