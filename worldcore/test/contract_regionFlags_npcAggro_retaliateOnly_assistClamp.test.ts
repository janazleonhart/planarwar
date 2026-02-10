// worldcore/test/contract_regionFlags_npcAggro_retaliateOnly_assistClamp.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { tryAssistNearbyNpcs } from "../combat/NpcCombat";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";

type FakeNpcState = {
  protoId: string;
  templateId: string;
  roomId: string;
  threat?: any;
  tags?: string[];
};

test("[contract] regions.flags npcAggro=retaliate_only clamps cross-room assist", () => {
  const old = process.env.PW_ASSIST_RADIUS_TILES;
  process.env.PW_ASSIST_RADIUS_TILES = "1";

  // Starter-safe belt: in this region, cross-room assist is clamped off.
  setRegionFlagsTestOverrides({
    prime_shard: {
      "0,0": { rules: { ai: { npcAggro: "retaliate_only" } } },
    },
  });

  try {
    const entities = new Map<string, any>();
    const npcStates = new Map<string, FakeNpcState>();

    const roomA = "prime_shard:0,0";
    const roomB = "prime_shard:1,0";

    const rooms = new Map<string, any>([
      [roomA, { entityIds: ["npc.a", "char.1"], broadcast() {} }],
      [roomB, { entityIds: ["npc.b"], broadcast() {} }],
    ]);

    // attacker
    entities.set("char.1", { id: "char.1", type: "character", alive: true });

    // ally being attacked
    entities.set("npc.a", { id: "npc.a", type: "npc", alive: true, name: "Goblin" });
    npcStates.set("npc.a", {
      protoId: "goblin",
      templateId: "goblin",
      roomId: roomA,
      threat: { lastAggroAt: Date.now(), threatByEntityId: { "char.1": 5 } },
    });

    // social assister in nearby room (tile neighbor)
    entities.set("npc.b", { id: "npc.b", type: "npc", alive: true, name: "Goblin Ally" });
    npcStates.set("npc.b", {
      protoId: "goblin_social",
      templateId: "goblin_social",
      roomId: roomB,
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

    const now = Date.now();
    const assisted = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", now, 2);

    assert.equal(assisted, 0);
    assert.deepEqual(recordCalls, []);
  } finally {
    setRegionFlagsTestOverrides(null);
    if (old == null) delete process.env.PW_ASSIST_RADIUS_TILES;
    else process.env.PW_ASSIST_RADIUS_TILES = old;
  }
});
