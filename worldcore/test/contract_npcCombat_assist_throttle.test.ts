// worldcore/test/contract_npcCombat_assist_throttle.test.ts

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

test("[contract] NpcCombat: assist throttles per assister within cooldown window", () => {
  const entities = new Map<string, any>();
  const npcStates = new Map<string, FakeNpcState>();

  const roomId = "room:1";
  const room: any = {
    entityIds: ["npc.a", "npc.b", "char.1"],
    broadcast() {},
  };
  const rooms = new Map<string, any>([[roomId, room]]);

  const t0 = Date.now();

  // attacker
  entities.set("char.1", { id: "char.1", type: "character", alive: true });

  // ally being attacked
  entities.set("npc.a", { id: "npc.a", type: "npc", alive: true });
  npcStates.set("npc.a", {
    protoId: "goblin",
    templateId: "goblin",
    roomId,
    threat: { lastAggroAt: t0, threatByEntityId: { "char.1": 5 } },
  });

  // social assister
  entities.set("npc.b", { id: "npc.b", type: "npc", alive: true });
  npcStates.set("npc.b", {
    protoId: "goblin_social",
    templateId: "goblin_social",
    roomId,
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


  const a1 = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", t0, 2);
  const a2 = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", t0 + 1000, 2); // within 4s cooldown

  assert.equal(a1, 1);
  assert.equal(a2, 0);
  assert.deepEqual(recordCalls, [{ npcId: "npc.b", attackerId: "char.1", dmg: 2 }]);
});
