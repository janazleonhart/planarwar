// worldcore/test/contract_npcCombat_gateForHelp_pushbackInterrupt.test.ts

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

test("[contract] NpcCombat: gate cast pushback delays completion (deterministic)", () => {
  const prev = {
    enabled: process.env.PW_GATE_FOR_HELP_ENABLED,
    tag: process.env.PW_GATE_FOR_HELP_TAG,
    castMs: process.env.PW_GATE_FOR_HELP_CAST_MS,
    cooldownMs: process.env.PW_GATE_FOR_HELP_COOLDOWN_MS,
    hpPct: process.env.PW_GATE_FOR_HELP_HP_PCT,
    radiusTiles: process.env.PW_GATE_FOR_HELP_RADIUS_TILES,
    interruptPct: process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT,
    interruptFlat: process.env.PW_GATE_FOR_HELP_INTERRUPT_FLAT,
    assistRadius: process.env.PW_ASSIST_RADIUS_TILES,
    assistCalls: process.env.PW_ASSIST_CALLS_LINE,

    pushPer: process.env.PW_GATE_FOR_HELP_PUSHBACK_PER_DMG_MS,
    pushMax: process.env.PW_GATE_FOR_HELP_PUSHBACK_MAX_MS,
    pushTotalMax: process.env.PW_GATE_FOR_HELP_PUSHBACK_TOTAL_MAX_MS,
  };

  process.env.PW_GATE_FOR_HELP_ENABLED = "true";
  process.env.PW_GATE_FOR_HELP_TAG = "gater";
  process.env.PW_GATE_FOR_HELP_CAST_MS = "8000";
  process.env.PW_GATE_FOR_HELP_COOLDOWN_MS = "20000";
  process.env.PW_GATE_FOR_HELP_HP_PCT = "0.5";
  process.env.PW_GATE_FOR_HELP_RADIUS_TILES = "6";

  // Disable “damage interrupts gate” for this test; we want pushback, not cancel.
  process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT = "0";
  process.env.PW_GATE_FOR_HELP_INTERRUPT_FLAT = "0";

  // Keep normal assist small so only gate can pull far ally.
  process.env.PW_ASSIST_RADIUS_TILES = "2";
  process.env.PW_ASSIST_CALLS_LINE = "false";

  // Pushback tuning: 5 dmg -> +1000ms
  process.env.PW_GATE_FOR_HELP_PUSHBACK_PER_DMG_MS = "200";
  process.env.PW_GATE_FOR_HELP_PUSHBACK_MAX_MS = "5000";
  process.env.PW_GATE_FOR_HELP_PUSHBACK_TOTAL_MAX_MS = "5000";

  try {
    const entities = new Map<string, any>();
    const npcStates = new Map<string, FakeNpcState>();

    const roomAId = "prime_shard:0,0";
    const roomFarId = "prime_shard:5,0"; // outside assist radius(2), inside gate radius(6)

    const chats: string[] = [];

    const roomA: any = {
      entityIds: ["npc.gater", "char.1"],
      broadcast(_kind: string, msg: any) {
        if (msg?.text) chats.push(String(msg.text));
      },
    };
    const roomFar: any = {
      entityIds: ["npc.far"],
      broadcast() {},
    };

    const rooms = new Map<string, any>([
      [roomAId, roomA],
      [roomFarId, roomFar],
    ]);

    const t0 = Date.now();

    // attacker
    entities.set("char.1", { id: "char.1", type: "character", alive: true });

    // gater being attacked (below 50% to qualify)
    entities.set("npc.gater", { id: "npc.gater", type: "npc", alive: true, name: "Bandit Gater", hp: 40, maxHp: 100 });
    npcStates.set("npc.gater", {
      protoId: "bandit_gater",
      templateId: "bandit_gater",
      roomId: roomAId,
      tags: ["gater"],
      threat: { lastAggroAt: t0, threatByEntityId: { "char.1": 10 } },
    });

    // far ally
    entities.set("npc.far", { id: "npc.far", type: "npc", alive: true });
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

    // 1) Start the gate cast.
    const s0 = tryAssistNearbyNpcs(ctx, "npc.gater", "char.1", t0, 2, 1);
    assert.equal(s0, 0);
    assert.ok(chats.some((t) => /begins to gate/i.test(t)), "should announce gate start");

    // 2) Apply damage during cast: should push back completion by +1000ms.
    const s1 = tryAssistNearbyNpcs(ctx, "npc.gater", "char.1", t0 + 1000, 2, 5);
    assert.equal(s1, 0);

    // 3) At original end (t0+8000), should NOT have pulled far ally yet.
    const s2 = tryAssistNearbyNpcs(ctx, "npc.gater", "char.1", t0 + 8000, 2, 0);
    assert.equal(s2, 0);
    assert.equal(recordCalls.filter((c) => c.npcId === "npc.far").length, 0);

    // 4) At pushed end (t0+9000), it should fire and pull exactly one ally.
    const s3 = tryAssistNearbyNpcs(ctx, "npc.gater", "char.1", t0 + 9000, 2, 0);
    assert.equal(s3, 1, "should assist exactly one ally at pushed completion time");
    assert.equal(recordCalls.filter((c) => c.npcId === "npc.far").length, 1);
  } finally {
    process.env.PW_GATE_FOR_HELP_ENABLED = prev.enabled;
    process.env.PW_GATE_FOR_HELP_TAG = prev.tag;
    process.env.PW_GATE_FOR_HELP_CAST_MS = prev.castMs;
    process.env.PW_GATE_FOR_HELP_COOLDOWN_MS = prev.cooldownMs;
    process.env.PW_GATE_FOR_HELP_HP_PCT = prev.hpPct;
    process.env.PW_GATE_FOR_HELP_RADIUS_TILES = prev.radiusTiles;
    process.env.PW_GATE_FOR_HELP_INTERRUPT_HP_PCT = prev.interruptPct;
    process.env.PW_GATE_FOR_HELP_INTERRUPT_FLAT = prev.interruptFlat;
    process.env.PW_ASSIST_RADIUS_TILES = prev.assistRadius;
    process.env.PW_ASSIST_CALLS_LINE = prev.assistCalls;

    process.env.PW_GATE_FOR_HELP_PUSHBACK_PER_DMG_MS = prev.pushPer;
    process.env.PW_GATE_FOR_HELP_PUSHBACK_MAX_MS = prev.pushMax;
    process.env.PW_GATE_FOR_HELP_PUSHBACK_TOTAL_MAX_MS = prev.pushTotalMax;
  }
});
