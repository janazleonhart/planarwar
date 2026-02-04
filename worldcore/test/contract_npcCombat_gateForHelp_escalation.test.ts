// worldcore/test/contract_npcCombat_gateForHelp_escalation.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { tryAssistNearbyNpcs } from "../combat/NpcCombat";

test("[contract] NpcCombat: successful gates escalate assist radius (train gets worse if ignored)", () => {
  process.env.PW_GATE_FOR_HELP_ENABLED = "true";
  process.env.PW_GATE_FOR_HELP_TAG = "gater";
  process.env.PW_GATE_FOR_HELP_CAST_MS = "1000";
  process.env.PW_GATE_FOR_HELP_RADIUS_TILES = "1"; // base too small to reach far ally
  process.env.PW_GATE_FOR_HELP_SEED_MULT = "2";
  process.env.PW_GATE_FOR_HELP_WAVES = "1";
  process.env.PW_GATE_FOR_HELP_WAVE_INTERVAL_MS = "3000";
  process.env.PW_GATE_FOR_HELP_MAX_ASSISTS_PER_WAVE = "5";
  process.env.PW_GATE_FOR_HELP_ESCALATION_MAX = "3";
  process.env.PW_GATE_FOR_HELP_ESCALATION_RADIUS_STEP = "1";

  process.env.PW_ASSIST_RADIUS_TILES = "1";
  process.env.PW_ASSIST_COOLDOWN_MS = "0";
  process.env.PW_ASSIST_CALLS_LINE = "false";
  process.env.PW_GATE_FOR_HELP_HP_PCT = "0.9";

  const now0 = 2_000_000;
  const attackerId = "p1";

  const roomA = { entityIds: ["ally"] };
  const room2 = { entityIds: ["far"] }; // distance 2 (needs escalation)

  const rooms = new Map<string, any>([
    ["prime_shard:0,0", roomA],
    ["prime_shard:2,0", room2],
  ]);

  const entities = new Map<string, any>([
    ["ally", { id: "ally", type: "npc", name: "Gate Goblin", hp: 80, maxHp: 100, alive: true }],
    ["far", { id: "far", type: "npc", name: "Far Ally", hp: 100, maxHp: 100, alive: true }],
  ]);

  const allyThreat = { lastAggroAt: now0, threatByEntityId: { [attackerId]: 2 } };
  const recorded: Array<{ npcId: string; attackerId: string; amt: number }> = [];

  const npcs = {
    getNpcStateByEntityId: (id: string) => {
      if (id === "ally") return { roomId: "prime_shard:0,0", templateId: "gater_proto", protoId: "gater_proto", threat: allyThreat, tags: ["social", "gater"] };
      if (id === "far") return { roomId: "prime_shard:2,0", templateId: "ally_proto", protoId: "ally_proto", tags: ["social"] };
      return null;
    },
    recordDamage: (npcId: string, attacker: string, amt: number) => recorded.push({ npcId, attackerId: attacker, amt }),
  };

  const ctx: any = { rooms, entities, npcs };

  // start cast
  assert.equal(tryAssistNearbyNpcs(ctx, "ally", attackerId, now0, 1), 0);

  // completion: radius should be base(1) + esc(1)*step(1) = 2, so it reaches the far ally.
  const now1 = now0 + 1000;
  assert.equal(tryAssistNearbyNpcs(ctx, "ally", attackerId, now1, 1), 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].npcId, "far");
  assert.equal((entities.get("ally") as any)._pwGateForHelpEscalation, 1);
});
