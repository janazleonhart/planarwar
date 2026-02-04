// worldcore/test/contract_npcCombat_gateForHelp_interrupt.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { tryAssistNearbyNpcs } from "../combat/NpcCombat";

type FakeNpcState = {
  protoId: string;
  templateId: string;
  roomId: string;
  threat?: any;
  tags?: string[];
  lastAssistAt?: number;
};

test("[contract] NpcCombat: gate cast can be interrupted by damage (prevents long-range assist burst)", () => {
  // Make the test deterministic and isolated.
  const prev = {
    enabled: process.env.PW_GATE_FOR_HELP_ENABLED,
    castMs: process.env.PW_GATE_FOR_HELP_CAST_MS,
    cooldownMs: process.env.PW_GATE_FOR_HELP_COOLDOWN_MS,
    hpPct: process.env.PW_GATE_FOR_HELP_HP_PCT,
    radiusTiles: process.env.PW_GATE_FOR_HELP_RADIUS_TILES,
    tag: process.env.PW_GATE_FOR_HELP_TAG,
    interruptPct: process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT,
    assistRadius: process.env.PW_ASSIST_RADIUS_TILES,
    assistCalls: process.env.PW_ASSIST_CALLS_LINE,
  };

  process.env.PW_GATE_FOR_HELP_ENABLED = "true";
  process.env.PW_GATE_FOR_HELP_TAG = "gater";
  process.env.PW_GATE_FOR_HELP_CAST_MS = "8000";
  process.env.PW_GATE_FOR_HELP_COOLDOWN_MS = "20000";
  process.env.PW_GATE_FOR_HELP_HP_PCT = "0.5";
  process.env.PW_GATE_FOR_HELP_RADIUS_TILES = "6";
  process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT = "0.10";
  // Keep normal assist small so the only way to pull the far ally is via gate.
  process.env.PW_ASSIST_RADIUS_TILES = "2";
  process.env.PW_ASSIST_CALLS_LINE = "false";

  try {
    const entities = new Map<string, any>();
    const npcStates = new Map<string, FakeNpcState>();

    const roomAId = "prime_shard:0,0";
    const roomFarId = "prime_shard:5,0"; // outside normal radius (2), inside gate radius (6)

    const chats: string[] = [];

    const roomA: any = {
      entityIds: ["npc.a", "char.1"],
      broadcast(_kind: string, msg: any) {
        if (msg?.text) chats.push(String(msg.text));
      },
    };
    const roomFar: any = {
      entityIds: ["npc.b"],
      broadcast() {},
    };

    const rooms = new Map<string, any>([
      [roomAId, roomA],
      [roomFarId, roomFar],
    ]);

    const t0 = Date.now();

    // attacker
    entities.set("char.1", { id: "char.1", type: "character", alive: true });

    // gater being attacked
    entities.set("npc.a", { id: "npc.a", type: "npc", alive: true, name: "Bandit Gater", hp: 40, maxHp: 100 });
    npcStates.set("npc.a", {
      protoId: "bandit_gater",
      templateId: "bandit_gater",
      roomId: roomAId,
      tags: ["gater"],
      threat: { lastAggroAt: t0, threatByEntityId: { "char.1": 10 } },
    });

    // far ally that could be pulled only by the gate burst
    entities.set("npc.b", { id: "npc.b", type: "npc", alive: true });
    npcStates.set("npc.b", {
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

    // 1) Start the gate cast.
    const s0 = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", t0, 2, 1);
    assert.equal(s0, 0);
    assert.ok(chats.some((t) => /begins to gate/i.test(t)), "should announce gate start");

    // 2) During the cast window, land a big hit (>=10% max hp) to interrupt.
    const s1 = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", t0 + 1000, 2, 15);
    assert.equal(s1, 0);
    assert.ok(chats.some((t) => /gate fizzles/i.test(t)), "should announce gate interruption");

    // 3) Even after the cast would have completed, no long-range assist burst should happen.
    const s2 = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", t0 + 9000, 2, 1);
    assert.equal(s2, 0, "should not pull far ally after interrupted gate");

    // And we should not have seeded threat on the far ally.
    assert.equal(recordCalls.filter((c) => c.npcId === "npc.b").length, 0);
  } finally {
    process.env.PW_GATE_FOR_HELP_ENABLED = prev.enabled;
    process.env.PW_GATE_FOR_HELP_CAST_MS = prev.castMs;
    process.env.PW_GATE_FOR_HELP_COOLDOWN_MS = prev.cooldownMs;
    process.env.PW_GATE_FOR_HELP_HP_PCT = prev.hpPct;
    process.env.PW_GATE_FOR_HELP_RADIUS_TILES = prev.radiusTiles;
    process.env.PW_GATE_FOR_HELP_TAG = prev.tag;
    process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT = prev.interruptPct;
    process.env.PW_ASSIST_RADIUS_TILES = prev.assistRadius;
    process.env.PW_ASSIST_CALLS_LINE = prev.assistCalls;
  }
});
