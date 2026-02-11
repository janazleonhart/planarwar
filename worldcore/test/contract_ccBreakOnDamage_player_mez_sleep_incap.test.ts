// worldcore/test/contract_ccBreakOnDamage_player_mez_sleep_incap.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applyStatusEffect, clearAllStatusEffects, getActiveStatusEffects } from "../combat/StatusEffects";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";

function makeChar(id: string): any {
  return {
    id,
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

function hasTag(effs: any[], tag: string): boolean {
  const t = String(tag).toLowerCase();
  return effs.some((e) => Array.isArray(e?.tags) && e.tags.map((x: any) => String(x).toLowerCase()).includes(t));
}

test("[contract] break-on-damage CC: player mez/sleep/incapacitate clear on any meaningful damage", () => {
  const c: any = makeChar("c");
  clearAllStatusEffects(c);

  const now = 1000;
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
    now,
  );

  applyStatusEffect(
    c,
    {
      id: "sleep_a",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "sleep"],
    },
    now,
  );

  applyStatusEffect(
    c,
    {
      id: "incap_a",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "incapacitate"],
    },
    now,
  );

  const pre = getActiveStatusEffects(c, now);
  assert.equal(hasTag(pre, "mez"), true);
  assert.equal(hasTag(pre, "sleep"), true);
  assert.equal(hasTag(pre, "incapacitate"), true);

  const ent: any = { hp: 100, maxHp: 100, alive: true };
  applySimpleDamageToPlayer(ent, 5, c, "physical");

  const post = getActiveStatusEffects(c, Date.now());
  assert.equal(hasTag(post, "mez"), false);
  assert.equal(hasTag(post, "sleep"), false);
  assert.equal(hasTag(post, "incapacitate"), false);
});
