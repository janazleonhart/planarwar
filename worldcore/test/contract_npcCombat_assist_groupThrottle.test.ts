// worldcore/test/contract_npcCombat_assist_groupThrottle.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { tryAssistNearbyNpcs } from "../combat/NpcCombat";

type FakeNpcState = {
  protoId: string;
  templateId: string;
  roomId: string;
  threat?: any;
  tags?: string[];
  groupId?: string;
};

test("[contract] NpcCombat: assist group throttle prevents multi-ally cascades in one tick", () => {
  // Ensure default-enabled throttle is on (explicit for test clarity).
  const prev = process.env.PW_ASSIST_GROUP_THROTTLE_ENABLED;
  process.env.PW_ASSIST_GROUP_THROTTLE_ENABLED = "true";

  const entities = new Map<string, any>();
  const npcStates = new Map<string, FakeNpcState>();

  const roomId = "room:1";
  const room: any = {
    entityIds: ["npc.leader", "npc.ally", "npc.social", "char.1"],
    broadcast() {},
  };
  const rooms = new Map<string, any>([[roomId, room]]);

  const t0 = Date.now();

  // attacker
  entities.set("char.1", { id: "char.1", type: "character", alive: true });

  // Two pack allies in the SAME group. Either one taking damage could trigger assist scanning.
  // The group throttle should allow only ONE assist scan at this exact tick (t0).
  entities.set("npc.leader", { id: "npc.leader", type: "npc", alive: true });
  npcStates.set("npc.leader", {
    protoId: "goblin_pack",
    templateId: "goblin_pack",
    roomId,
    groupId: "pack.1",
    threat: { lastAggroAt: t0, threatByEntityId: { "char.1": 5 } },
  });

  entities.set("npc.ally", { id: "npc.ally", type: "npc", alive: true });
  npcStates.set("npc.ally", {
    protoId: "goblin_pack",
    templateId: "goblin_pack",
    roomId,
    groupId: "pack.1",
    threat: { lastAggroAt: t0, threatByEntityId: { "char.1": 5 } },
  });

  // social assister (opt-in assist)
  entities.set("npc.social", { id: "npc.social", type: "npc", alive: true });
  npcStates.set("npc.social", {
    protoId: "goblin_social",
    templateId: "goblin_social",
    roomId,
    tags: ["social"],
  });

  const recordCalls: Array<{ npcId: string; attackerId: string; dmg: number }> = [];

  const ctx: any = {
    entities: {
      get: (id: string) => entities.get(id),
    },
    rooms,
    npcs: {
      getNpcStateByEntityId: (id: string) => npcStates.get(id),
      recordDamage: (npcId: string, attackerId: string, dmg: number) => {
        recordCalls.push({ npcId, attackerId, dmg });
      },
    },
  };

  const a1 = tryAssistNearbyNpcs(ctx, "npc.leader", "char.1", t0, 2);
  const a2 = tryAssistNearbyNpcs(ctx, "npc.ally", "char.1", t0, 2);

  assert.equal(a1, 1);
  assert.equal(a2, 0);

  // Only the social NPC should be seeded once.
  assert.deepEqual(recordCalls, [{ npcId: "npc.social", attackerId: "char.1", dmg: 2 }]);

  if (prev == null) delete process.env.PW_ASSIST_GROUP_THROTTLE_ENABLED;
  else process.env.PW_ASSIST_GROUP_THROTTLE_ENABLED = prev;
});
