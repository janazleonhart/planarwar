// worldcore/test/contract_npcCombat_assist_threatShare.test.ts

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

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("[contract] NpcCombat: assist seeds weighted threat share from ally threat table when enabled", () => {
  withEnv(
    {
      PW_ASSIST_SHARE_THREAT_PCT: "0.25",
      PW_ASSIST_MAX_SHARED_TARGETS: "2",
      // Keep top-target extra disabled so legacy scaling stays predictable in this contract.
      PW_ASSIST_SEED_TOP_TARGET_THREAT: "0",
    },
    () => {
      const entities = new Map<string, any>();
      const npcStates = new Map<string, FakeNpcState>();

      const roomId = "room:1";
      const room: any = {
        entityIds: ["npc.a", "npc.guard", "char.1", "char.2"],
        broadcast() {},
      };
      const rooms = new Map<string, any>([[roomId, room]]);

      // players
      entities.set("char.1", { id: "char.1", type: "character", alive: true });
      entities.set("char.2", { id: "char.2", type: "character", alive: true });

      // ally being attacked
      entities.set("npc.a", { id: "npc.a", type: "npc", alive: true, name: "Goblin" });
      npcStates.set("npc.a", {
        protoId: "goblin",
        templateId: "goblin",
        roomId,
        threat: {
          lastAggroAt: Date.now(),
          threatByEntityId: { "char.1": 10, "char.2": 6 },
        },
      });

      // assister (social guard)
      entities.set("npc.guard", {
        id: "npc.guard",
        type: "npc",
        alive: true,
        name: "Town Guard",
        tags: ["guard"],
      });
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

      // base seedThreat=4 -> guard scaling 2x => 8 (top target)
      // plus share: char.2 threat 6 * 0.25 => floor 1 => min 1
      const assisted = tryAssistNearbyNpcs(ctx, "npc.a", "char.1", now, 4);

      assert.equal(assisted, 1);

      recordCalls.sort((a, b) => (a.npcId + a.attackerId).localeCompare(b.npcId + b.attackerId));
      assert.deepEqual(recordCalls, [
        { npcId: "npc.guard", attackerId: "char.1", dmg: 8 },
        { npcId: "npc.guard", attackerId: "char.2", dmg: 1 },
      ]);
    },
  );
});
