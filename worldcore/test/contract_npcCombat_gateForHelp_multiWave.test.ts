// worldcore/test/contract_npcCombat_gateForHelp_multiWave.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { tryAssistNearbyNpcs } from "../combat/NpcCombat";

test("[contract] NpcCombat: gate-for-help fires multi-wave pulses that pull additional allies (deterministic cap)", () => {
  process.env.PW_GATE_FOR_HELP_ENABLED = "true";
  process.env.PW_GATE_FOR_HELP_TAG = "gater";
  process.env.PW_GATE_FOR_HELP_CAST_MS = "1000";
  process.env.PW_GATE_FOR_HELP_RADIUS_TILES = "4";
  process.env.PW_GATE_FOR_HELP_SEED_MULT = "2";
  process.env.PW_GATE_FOR_HELP_WAVES = "2";
  process.env.PW_GATE_FOR_HELP_WAVE_INTERVAL_MS = "3000";
  process.env.PW_GATE_FOR_HELP_MAX_ASSISTS_PER_WAVE = "1";

  process.env.PW_ASSIST_RADIUS_TILES = "1";
  process.env.PW_ASSIST_COOLDOWN_MS = "0";
  process.env.PW_ASSIST_CALLS_LINE = "false";
  process.env.PW_GATE_FOR_HELP_HP_PCT = "0.9";

  const now0 = 1_000_000;
  const attackerId = "p1";

  const roomA = { entityIds: ["ally"] };
  const room3 = { entityIds: ["a2"] };
  const room4 = { entityIds: ["a1"] };

  const rooms = new Map<string, any>([
    ["prime_shard:0,0", roomA],
    ["prime_shard:3,0", room3],
    ["prime_shard:4,0", room4],
  ]);

  const entities = new Map<string, any>([
    ["ally", { id: "ally", type: "npc", name: "Gate Goblin", hp: 80, maxHp: 100, alive: true }],
    ["a1", { id: "a1", type: "npc", name: "Ally One", hp: 100, maxHp: 100, alive: true }],
    ["a2", { id: "a2", type: "npc", name: "Ally Two", hp: 100, maxHp: 100, alive: true }],
  ]);

  const allyThreat = { lastAggroAt: now0, threatByEntityId: { [attackerId]: 2 } };
  const recorded: Array<{ npcId: string; attackerId: string; amt: number }> = [];

  const npcs = {
    getNpcStateByEntityId: (id: string) => {
      if (id === "ally") return { roomId: "prime_shard:0,0", templateId: "gater_proto", protoId: "gater_proto", threat: allyThreat, tags: ["social", "gater"] };
      if (id === "a1") return { roomId: "prime_shard:4,0", templateId: "ally_proto", protoId: "ally_proto", tags: ["social"] };
      if (id === "a2") return { roomId: "prime_shard:3,0", templateId: "ally_proto", protoId: "ally_proto", tags: ["social"] };
      return null;
    },
    recordDamage: (npcId: string, attacker: string, amt: number) => recorded.push({ npcId, attackerId: attacker, amt }),
  };

  const ctx: any = { rooms, entities, npcs };

  // start cast
  assert.equal(tryAssistNearbyNpcs(ctx, "ally", attackerId, now0, 1), 0);

  // wave 1 at cast completion
  const now1 = now0 + 1000;
  assert.equal(tryAssistNearbyNpcs(ctx, "ally", attackerId, now1, 1), 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].npcId, "a1", "deterministic: cap=1 pulls lowest id first");

  // wave 2 after interval
  const now2 = now1 + 3000;
  assert.equal(tryAssistNearbyNpcs(ctx, "ally", attackerId, now2, 1), 1);
  assert.equal(recorded.length, 2);
  assert.equal(recorded[1].npcId, "a2", "second wave pulls the next ally");
});
