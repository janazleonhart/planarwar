// worldcore/test/contract_npcCombat_assist_strengthScaling.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { tryAssistNearbyNpcs } from "../combat/NpcCombat";

type FakeNpcState = {
  protoId: string;
  templateId: string;
  roomId: string;
  threat?: any;
  tags?: string[];
};

test("[contract] NpcCombat: assist strength scaling (rats help a little, guards help a lot)", () => {
  const entities = new Map<string, any>();
  const npcStates = new Map<string, FakeNpcState>();

  const roomId = "room:1";
  const room: any = {
    entityIds: ["npc.a", "npc.rat", "npc.guard", "char.1"],
    broadcast() {},
  };

  const rooms = new Map<string, any>([[roomId, room]]);

  // attacker
  entities.set("char.1", { id: "char.1", type: "character", alive: true });

  // ally being attacked
  entities.set("npc.a", { id: "npc.a", type: "npc", alive: true, name: "Goblin" });
  npcStates.set("npc.a", {
    protoId: "goblin",
    templateId: "goblin",
    roomId,
    threat: { lastAggroAt: Date.now(), threatByEntityId: { "char.1": 5 } },
  });

  // rat assister (weak)
  entities.set("npc.rat", { id: "npc.rat", type: "npc", alive: true, name: "Town Rat", tags: ["rat"] });
  npcStates.set("npc.rat", {
    protoId: "rat_social",
    templateId: "rat_social",
    roomId,
    tags: ["social", "rat"],
    threat: { lastAggroAt: 0, threatByEntityId: {} },
  });

  // guard assister (strong)
  entities.set("npc.guard", { id: "npc.guard", type: "npc", alive: true, name: "Town Guard", tags: ["guard"] });
  npcStates.set("npc.guard", {
    protoId: "guard_social",
    templateId: "guard_social",
    roomId,
    tags: ["social", "guard"],
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

  // base seedThreat=2 -> rat ~1, guard ~4 with current scaling.
  const assisted = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", now, 2);

  assert.equal(assisted, 2);

  // Order isn't guaranteed, so compare as sets.
  recordCalls.sort((a, b) => a.npcId.localeCompare(b.npcId));
  assert.deepEqual(recordCalls, [
    { npcId: "npc.guard", attackerId: "char.1", dmg: 4 },
    { npcId: "npc.rat", attackerId: "char.1", dmg: 1 },
  ]);
});
