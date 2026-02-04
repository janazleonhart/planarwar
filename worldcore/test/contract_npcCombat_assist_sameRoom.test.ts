// worldcore/test/contract_npcCombat_assist_sameRoom.test.ts

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

test("[contract] NpcCombat: same-room assist seeds threat for social NPC allies", () => {
  const entities = new Map<string, any>();
  const npcStates = new Map<string, FakeNpcState>();

  const roomId = "room:1";
  const room: any = {
    entityIds: ["npc.a", "npc.b", "char.1"],
    broadcast() {},
  };

  const rooms = new Map<string, any>([[roomId, room]]);

  // attacker
  entities.set("char.1", { id: "char.1", type: "character", alive: true });

  // ally being attacked
  entities.set("npc.a", { id: "npc.a", type: "npc", alive: true });
  npcStates.set("npc.a", { protoId: "goblin", templateId: "goblin", roomId, threat: { lastAggroAt: Date.now(), threatByEntityId: { "char.1": 5 } } });

  // social assister
  entities.set("npc.b", { id: "npc.b", type: "npc", alive: true });
  npcStates.set("npc.b", { protoId: "goblin_social", templateId: "goblin_social", roomId, tags: ["social"], threat: { lastAggroAt: 0, threatByEntityId: {} } });

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

  // Monkeypatch getNpcPrototype lookup by providing expected global registry shape via proto ids.
  // In production, getNpcPrototype is real; for contract, we just need tags.
  const now = Date.now();

  // Call assist: should seed threat on npc.b (social), not on npc.a itself.
  const assisted = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", now, 2);

  assert.equal(assisted, 1);
  assert.deepEqual(recordCalls, [{ npcId: "npc.b", attackerId: "char.1", dmg: 2 }]);
});
