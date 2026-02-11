// worldcore/test/contract_ccDiminishingReturns_presetClassic_mez_sleep_player_npc.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyStatusEffect,
  applyStatusEffectToEntity,
  clearAllStatusEffects,
} from "../combat/StatusEffects";

function makeChar(id: string): any {
  return {
    id,
    level: 1,
    progression: {},
    attributes: { str: 10, int: 10 },
  };
}

test("[contract] CC DR preset classic: mez and sleep share buckets for player + npc", () => {
  process.env.PW_CC_DR_ENABLED = "true";
  process.env.PW_CC_DR_WINDOW_MS = "18000";
  process.env.PW_CC_DR_TAGS = "mez,sleep";
  process.env.PW_CC_DR_MULTS = "1,0.5,0.25";
  delete process.env.PW_CC_DR_BUCKETS;
  process.env.PW_CC_DR_BUCKET_PRESET = "classic";

  // Player
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

  // NPC/entity
  const npc: any = { id: "npc1" };
  const now3 = 3000;
  const e1 = applyStatusEffectToEntity(
    npc,
    {
      id: "mez_e",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "mez"],
    },
    now3,
  );
  assert.equal(e1.expiresAtMs - now3, 10_000);

  const now4 = 4000;
  const e2 = applyStatusEffectToEntity(
    npc,
    {
      id: "sleep_e",
      sourceKind: "spell",
      sourceId: "test",
      durationMs: 10_000,
      modifiers: {},
      tags: ["debuff", "sleep"],
    },
    now4,
  );
  assert.equal(e2.expiresAtMs - now4, 5_000);
});
