// worldcore/test/contract_ccDiminishingReturns_presetPvp_hardcc_mez_stun_player_npc.test.ts

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

test("[contract] CC DR preset pvp: mez and stun share hardcc bucket for player + npc", () => {
  const envBefore = { ...process.env };
  try {
    process.env.PW_CC_DR_ENABLED = "true";
    process.env.PW_CC_DR_WINDOW_MS = "18000";
    process.env.PW_CC_DR_TAGS = "mez,stun";
    process.env.PW_CC_DR_MULTS = "1,0.5";
    delete process.env.PW_CC_DR_BUCKETS;
    process.env.PW_CC_DR_BUCKET_PRESET = "pvp";

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
        id: "stun_a",
        sourceKind: "spell",
        sourceId: "test",
        durationMs: 10_000,
        modifiers: {},
        tags: ["debuff", "stun"],
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
        id: "stun_e",
        sourceKind: "spell",
        sourceId: "test",
        durationMs: 10_000,
        modifiers: {},
        tags: ["debuff", "stun"],
      },
      now4,
    );
    assert.equal(e2.expiresAtMs - now4, 5_000);
  } finally {
    // Restore environment to avoid cross-test leakage.
    for (const k of Object.keys(process.env)) {
      if (!(k in envBefore)) delete (process.env as any)[k];
    }
    for (const [k, v] of Object.entries(envBefore)) {
      process.env[k] = v as string;
    }
  }
});
