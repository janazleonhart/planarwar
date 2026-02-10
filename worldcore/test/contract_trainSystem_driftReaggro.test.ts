// worldcore/test/contract_trainSystem_driftReaggro.test.ts
//
// Ensures optional drift re-aggro works while an NPC is returning home.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete (process.env as any)[k];
    else (process.env as any)[k] = v;
  }

  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  }
}

test("[contract] Train System: drift re-aggro can reacquire threat while returning (capped)", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TRAIN_STEP: "1",
      PW_TRAIN_SOFT_LEASH: "10",
      PW_TRAIN_HARD_LEASH: "15",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
      PW_TRAIN_RETURN_MODE: "drift",
      PW_TRAIN_DRIFT_REAGGRO_ENABLED: "1",
      PW_TRAIN_DRIFT_REAGGRO_RANGE_TILES: "1",
      PW_TRAIN_DRIFT_REAGGRO_MAX_HOPS: "1",
    },
    () => {
      const entities = new EntityManager();
      const npcMgr = new NpcManager(entities);

      const npcState = npcMgr.spawnNpcById("town_rat", "prime_shard:0,0", 0, 0, 0);
      assert.ok(npcState, "NPC should spawn");

      const npc = entities.get((npcState as any).entityId) as any;
      assert.ok(npc, "NPC entity should exist");

      // Mark returning with no threat.
      (npcState as any).trainReturning = true;
      (npc as any).trainReturning = true;
      (npcMgr as any).npcThreat.set(npc.id, {
        lastAttackerEntityId: undefined,
        lastAggroAt: 0,
        threatByEntityId: {},
      });

      // Place a player one tile away.
      const player = entities.createPlayerForSession("sess_drift_reaggro", "prime_shard:1,0") as any;
      assert.ok(player, "Player entity should exist");

      // First tick: drift hook should notice the player and seed threat, cancelling return.
      npcMgr.updateAll(250);
      const threat = (npcMgr as any).npcThreat.get(npc.id);
      const table = (threat?.threatByEntityId ?? {}) as Record<string, number>;
      assert.ok(Object.keys(table).length > 0, "NPC should reacquire threat during drift return");
      assert.ok(!((npcState as any).trainReturning || (npc as any).trainReturning), "Return state should be cancelled");
    },
  );
});
