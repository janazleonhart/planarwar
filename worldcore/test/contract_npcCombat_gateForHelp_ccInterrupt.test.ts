// worldcore/test/contract_npcCombat_gateForHelp_ccInterrupt.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { tryAssistNearbyNpcs } from "../combat/NpcCombat";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

type FakeNpcState = {
  protoId: string;
  templateId: string;
  roomId: string;
  threat?: any;
  tags?: string[];
};

test("[contract] NpcCombat: crowd control interrupts gate-for-help cast and prevents assist waves", () => {
  const prev = {
    enabled: process.env.PW_GATE_FOR_HELP_ENABLED,
    tag: process.env.PW_GATE_FOR_HELP_TAG,
    castMs: process.env.PW_GATE_FOR_HELP_CAST_MS,
    cooldownMs: process.env.PW_GATE_FOR_HELP_COOLDOWN_MS,
    hpPct: process.env.PW_GATE_FOR_HELP_HP_PCT,
    radiusTiles: process.env.PW_GATE_FOR_HELP_RADIUS_TILES,
    seedMult: process.env.PW_GATE_FOR_HELP_SEED_MULT,
    waves: process.env.PW_GATE_FOR_HELP_WAVES,
    waveInterval: process.env.PW_GATE_FOR_HELP_WAVE_INTERVAL_MS,
    maxAssists: process.env.PW_GATE_FOR_HELP_MAX_ASSISTS_PER_WAVE,
    interruptPct: process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT,
    interruptFlat: process.env.PW_GATE_FOR_HELP_INTERRUPT_FLAT,
    ccInterrupt: process.env.PW_GATE_FOR_HELP_CC_INTERRUPT,
    assistRadius: process.env.PW_ASSIST_RADIUS_TILES,
    assistCalls: process.env.PW_ASSIST_CALLS_LINE,
    assistCd: process.env.PW_ASSIST_COOLDOWN_MS,
  };

  process.env.PW_GATE_FOR_HELP_ENABLED = "true";
  process.env.PW_GATE_FOR_HELP_TAG = "gater";
  process.env.PW_GATE_FOR_HELP_CAST_MS = "5000";
  process.env.PW_GATE_FOR_HELP_COOLDOWN_MS = "20000";
  process.env.PW_GATE_FOR_HELP_HP_PCT = "0.9";
  process.env.PW_GATE_FOR_HELP_RADIUS_TILES = "6";
  process.env.PW_GATE_FOR_HELP_SEED_MULT = "2";
  process.env.PW_GATE_FOR_HELP_WAVES = "1";
  process.env.PW_GATE_FOR_HELP_WAVE_INTERVAL_MS = "3000";
  process.env.PW_GATE_FOR_HELP_MAX_ASSISTS_PER_WAVE = "1";

  // Disable damage interrupt so only CC can cancel.
  process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT = "0";
  process.env.PW_GATE_FOR_HELP_INTERRUPT_FLAT = "0";

  process.env.PW_GATE_FOR_HELP_CC_INTERRUPT = "true";

  process.env.PW_ASSIST_RADIUS_TILES = "2";
  process.env.PW_ASSIST_CALLS_LINE = "false";
  process.env.PW_ASSIST_COOLDOWN_MS = "0";

  try {
    const entities = new Map<string, any>();
    const npcStates = new Map<string, FakeNpcState>();

    const roomAId = "prime_shard:0,0";
    const roomFarId = "prime_shard:5,0";

    const chats: string[] = [];

    const roomA: any = {
      entityIds: ["npc.gater", "char.1"],
      broadcast(_kind: string, msg: any) {
        if (msg?.text) chats.push(String(msg.text));
      },
    };
    const roomFar: any = { entityIds: ["npc.far"], broadcast() {} };
    const rooms = new Map<string, any>([
      [roomAId, roomA],
      [roomFarId, roomFar],
    ]);

    const t0 = 1_000_000;

    entities.set("char.1", { id: "char.1", type: "character", alive: true });

    entities.set("npc.gater", { id: "npc.gater", type: "npc", alive: true, name: "Bandit Gater", hp: 80, maxHp: 100 });
    npcStates.set("npc.gater", {
      protoId: "bandit_gater",
      templateId: "bandit_gater",
      roomId: roomAId,
      tags: ["gater"],
      threat: { lastAggroAt: t0, threatByEntityId: { "char.1": 10 } },
    });

    entities.set("npc.far", { id: "npc.far", type: "npc", alive: true, name: "Far Ally" });
    npcStates.set("npc.far", {
      protoId: "bandit_far_ally",
      templateId: "bandit_far_ally",
      roomId: roomFarId,
      tags: ["social"],
      threat: { lastAggroAt: 0, threatByEntityId: {} },
    });

    const recordCalls: Array<{ npcId: string; attackerId: string; dmg: number }> = [];

    const ctx: any = {
      entities: { get: (id: string) => entities.get(id) },
      rooms,
      npcs: {
        getNpcStateByEntityId: (id: string) => npcStates.get(id),
        recordDamage: (npcId: string, attackerId: string, dmg: number) => {
          recordCalls.push({ npcId, attackerId, dmg });
        },
      },
    };

    // Start gate.
    assert.equal(tryAssistNearbyNpcs(ctx, "npc.gater", "char.1", t0, 2, 1), 0);
    assert.ok(chats.some((t) => /begins to gate/i.test(t)), "should announce gate start");

    // Apply a stun and tick assist during the cast.
    applyStatusEffectToEntity(entities.get("npc.gater"), { id: "stun", name: "Stun", durationMs: 10_000, modifiers: {}, tags: ["stun"] }, t0 + 1000);

    assert.equal(tryAssistNearbyNpcs(ctx, "npc.gater", "char.1", t0 + 1000, 2, 0), 0);
    assert.ok(chats.some((t) => /interrupted/i.test(t)), "should announce CC interrupt");

    // After original completion time, no assist should fire.
    assert.equal(tryAssistNearbyNpcs(ctx, "npc.gater", "char.1", t0 + 6000, 2, 1), 0);
    assert.equal(recordCalls.filter((c) => c.npcId === "npc.far").length, 0);
  } finally {
    process.env.PW_GATE_FOR_HELP_ENABLED = prev.enabled;
    process.env.PW_GATE_FOR_HELP_TAG = prev.tag;
    process.env.PW_GATE_FOR_HELP_CAST_MS = prev.castMs;
    process.env.PW_GATE_FOR_HELP_COOLDOWN_MS = prev.cooldownMs;
    process.env.PW_GATE_FOR_HELP_HP_PCT = prev.hpPct;
    process.env.PW_GATE_FOR_HELP_RADIUS_TILES = prev.radiusTiles;
    process.env.PW_GATE_FOR_HELP_SEED_MULT = prev.seedMult;
    process.env.PW_GATE_FOR_HELP_WAVES = prev.waves;
    process.env.PW_GATE_FOR_HELP_WAVE_INTERVAL_MS = prev.waveInterval;
    process.env.PW_GATE_FOR_HELP_MAX_ASSISTS_PER_WAVE = prev.maxAssists;
    process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT = prev.interruptPct;
    process.env.PW_GATE_FOR_HELP_INTERRUPT_FLAT = prev.interruptFlat;
    process.env.PW_GATE_FOR_HELP_CC_INTERRUPT = prev.ccInterrupt;
    process.env.PW_ASSIST_RADIUS_TILES = prev.assistRadius;
    process.env.PW_ASSIST_CALLS_LINE = prev.assistCalls;
    process.env.PW_ASSIST_COOLDOWN_MS = prev.assistCd;
  }
});
