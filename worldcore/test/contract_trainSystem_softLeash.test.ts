// worldcore/test/contract_trainSystem_softLeash.test.ts

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

test("[contract] Train System v0: when enabled, NPCs step toward threat target (soft leash)", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_STEP: "2",
      PW_TRAIN_SOFT_LEASH: "25",
      PW_TRAIN_HARD_LEASH: "40",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
    },
    () => {
      const roomId = "prime_shard:0,0";
      const entities = new EntityManager();
      const npcMgr = new NpcManager(entities);

      const npcState = npcMgr.spawnNpcById("town_rat", roomId, 0, 0, 0);
      assert.ok(npcState, "NPC should spawn");

      const npc = entities.get((npcState as any).entityId) as any;
      assert.ok(npc, "NPC entity should exist");

      const player = entities.createPlayerForSession("sess_train", roomId) as any;
      entities.setPosition(player.id, 30, 0, 0);

      const now = Date.now();
      (npcMgr as any).npcThreat.set(npc.id, {
        lastAttackerEntityId: player.id,
        lastAggroAt: now,
        threatByEntityId: { [player.id]: 100 },
      });

      npcMgr.updateAll(250);

      assert.ok(typeof npc.x === "number");
      assert.ok(npc.x > 0, "NPC should move toward target when out of melee range");
      assert.ok(npc.x <= 5, "NPC step should be small and deterministic-ish");
    },
  );
});

test("[contract] Train System v0: hard leash causes disengage + snapback", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_STEP: "3",
      PW_TRAIN_SOFT_LEASH: "10",
      PW_TRAIN_HARD_LEASH: "15",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
    },
    () => {
      const roomId = "prime_shard:0,0";
      const entities = new EntityManager();
      const npcMgr = new NpcManager(entities);

      const npcState = npcMgr.spawnNpcById("town_rat", roomId, 0, 0, 0);
      assert.ok(npcState, "NPC should spawn");

      const npc = entities.get((npcState as any).entityId) as any;

      const player = entities.createPlayerForSession("sess_train2", roomId) as any;
      entities.setPosition(player.id, 200, 0, 0);

      const now = Date.now();
      (npcMgr as any).npcThreat.set(npc.id, {
        lastAttackerEntityId: player.id,
        lastAggroAt: now,
        threatByEntityId: { [player.id]: 100 },
      });

      // Run enough ticks for the NPC to walk past the hard leash.
      for (let i = 0; i < 50; i++) {
        npcMgr.updateAll(250);
      }

      // On disengage, we snap back to spawn coords (0,0).
      assert.ok(Math.abs(npc.x - 0) < 0.0001, "NPC should snap back to home X on hard leash");
      assert.ok(Math.abs(npc.z - 0) < 0.0001, "NPC should snap back to home Z on hard leash");

      const threat = (npcMgr as any).npcThreat.get(npc.id);
      assert.ok(
        threat && Object.keys(threat.threatByEntityId ?? {}).length === 0,
        "threat should be cleared on disengage",
      );
    },
  );
});
