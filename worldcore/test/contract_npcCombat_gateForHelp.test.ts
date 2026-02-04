// worldcore/test/contract_npcCombat_gateForHelp.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { tryAssistNearbyNpcs } from "../combat/NpcCombat";

// NOTE: This is a pure-ish contract test that stubs only the minimal context
// tryAssistNearbyNpcs needs (rooms/entities/npcs). It does not depend on
// any concrete Room implementation.

test("[contract] NpcCombat: gater NPC starts a gate cast then pulls allies from an expanded radius", () => {
  // Make this deterministic.
  process.env.PW_GATE_FOR_HELP_ENABLED = "true";
  process.env.PW_GATE_FOR_HELP_TAG = "gater";
  process.env.PW_GATE_FOR_HELP_CAST_MS = "8000";
  process.env.PW_GATE_FOR_HELP_RADIUS_TILES = "4";
  process.env.PW_ASSIST_RADIUS_TILES = "1";
  process.env.PW_ASSIST_COOLDOWN_MS = "4000";
  process.env.PW_ASSIST_CALLS_LINE = "false";
  process.env.PW_GATE_FOR_HELP_HP_PCT = "0.5";
  process.env.PW_GATE_FOR_HELP_SEED_MULT = "2";

  const now0 = 1_000_000;
  const attackerId = "p1";

  // Rooms laid out in grid ids so radius math works.
  const roomA = { entityIds: ["ally"] };
  const roomFar = { entityIds: ["far"] }; // at distance 4

  const rooms = new Map<string, any>([
    ["prime_shard:0,0", roomA],
    ["prime_shard:4,0", roomFar],
  ]);

  const entities = new Map<string, any>([
    ["ally", { id: "ally", type: "npc", name: "Gate Goblin", hp: 40, maxHp: 100, alive: true }],
    ["far", { id: "far", type: "npc", name: "Far Goblin", hp: 100, maxHp: 100, alive: true }],
  ]);

  // Threat table says attacker is the current target.
  const allyThreat = {
    lastAggroAt: now0,
    threatByEntityId: { [attackerId]: 2 },
  };

  const recorded: Array<{ npcId: string; attackerId: string; amt: number }> = [];

  const npcs = {
    getNpcStateByEntityId: (id: string) => {
      if (id === "ally") {
        return {
          roomId: "prime_shard:0,0",
          templateId: "gater_proto",
          protoId: "gater_proto",
          threat: allyThreat,
          tags: ["social", "gater"],
        };
      }
      if (id === "far") {
        return {
          roomId: "prime_shard:4,0",
          templateId: "ally_proto",
          protoId: "ally_proto",
          tags: ["social"],
        };
      }
      return null;
    },
    recordDamage: (npcId: string, attacker: string, amt: number) => {
      recorded.push({ npcId, attackerId: attacker, amt });
    },
  };

  const ctx: any = { rooms, entities, npcs };

  // 1) First assist attempt should START the cast and do no assist.
  const a0 = tryAssistNearbyNpcs(ctx, "ally", attackerId, now0, 1);
  assert.equal(a0, 0);
  assert.ok((entities.get("ally") as any)._pwGateForHelpEndsAt, "should set gate end timestamp");
  assert.equal(recorded.length, 0);

  // 2) After cast completes, next call should pull the far ally (expanded radius) and seed threat.
  const now1 = now0 + 8000;
  const a1 = tryAssistNearbyNpcs(ctx, "ally", attackerId, now1, 1);
  assert.equal(a1, 1, "should assist exactly one ally from expanded radius");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].npcId, "far");
  assert.equal(recorded[0].attackerId, attackerId);
  assert.ok(recorded[0].amt >= 2, "seed threat should be boosted on gate");
});
