// worldcore/test/contract_trainSystem_returnHomeDrift.test.ts
//
// Verifies optional "drift home" return behavior for Train System disengage.
// Default behavior remains snapback (see contract_trainSystem_softLeash).

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) {
      delete (process.env as any)[k];
    } else {
      (process.env as any)[k] = v;
    }
  }

  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete (process.env as any)[k];
      } else {
        (process.env as any)[k] = v;
      }
    }
  }
}

test("[contract] Train System: when PW_TRAIN_RETURN_MODE=drift, trainReturning drifts toward spawn (no snap)", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_STEP: "3",
      PW_TRAIN_SOFT_LEASH: "10",
      PW_TRAIN_HARD_LEASH: "15",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
      PW_TRAIN_RETURN_MODE: "drift",
    },
    () => {
      const roomId = "prime_shard:0,0";
      const entities = new EntityManager();
      const npcMgr = new NpcManager(entities);

      // Use any NPC; this contract is about the drift-return mechanic, not aggression.
      const npcState = npcMgr.spawnNpcById("town_rat", roomId, 0, 0, 0);
      assert.ok(npcState, "NPC should spawn");

      const npc = entities.get((npcState as any).entityId) as any;
      assert.ok(npc, "NPC entity should exist");

      // Force the NPC away from spawn and mark it as returning with no threat.
      // This avoids relying on incidental chase behavior or prototype aggression.
      entities.setPosition(npc.id, 30, 0, 0);
      (npc as any).x = 30;
      (npc as any).z = 0;
      (npcState as any).x = 30;
      (npcState as any).z = 0;

      (npcMgr as any).npcThreat.set(npc.id, {
        lastAttackerEntityId: undefined,
        lastAggroAt: 0,
        threatByEntityId: {},
      });

      (npcState as any).trainReturning = true;
      (npc as any).trainReturning = true;

      // In drift mode, we should not instantly snap to exact spawn coords.
      npcMgr.updateAll(250);
      assert.ok(Math.abs(npc.x - 0) > 0.0001, "NPC should not snap back instantly in drift mode");

      // Now let it drift home.
      for (let i = 0; i < 200; i++) {
        npcMgr.updateAll(250);
        if (Math.abs(npc.x - 0) < 0.25 && Math.abs(npc.z - 0) < 0.25) break;
      }

      assert.ok(Math.abs(npc.x - 0) < 0.25, "NPC should drift close to home X");
      assert.ok(Math.abs(npc.z - 0) < 0.25, "NPC should drift close to home Z");
    },
  );
});
