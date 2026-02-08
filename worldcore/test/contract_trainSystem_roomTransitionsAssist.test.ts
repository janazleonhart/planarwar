// worldcore/test/contract_trainSystem_roomTransitionsAssist.test.ts

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

test("[contract] Train System v0.1: when rooms enabled, NPC pursues threat target across room tiles (bounded)", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_STEP: "2",
      PW_TRAIN_SOFT_LEASH: "25",
      PW_TRAIN_HARD_LEASH: "40",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TRAIN_MAX_ROOMS_FROM_SPAWN: "2",
      PW_TRAIN_ASSIST_ENABLED: "0",
      PW_TRAIN_ASSIST_SNAP_ALLIES: "0",
    },
    () => {
      const spawnRoom = "prime_shard:0,0";
      const targetRoom = "prime_shard:2,0";

      const entities = new EntityManager();
      const npcMgr = new NpcManager(entities);

      const npcState = npcMgr.spawnNpcById("coward_rat", spawnRoom, 0, 0, 0);
      assert.ok(npcState, "NPC should spawn");

      const npc = entities.get((npcState as any).entityId) as any;
      assert.ok(npc, "NPC entity should exist");

      const player = entities.createPlayerForSession("sess_train_rooms", targetRoom) as any;
      entities.setPosition(player.id, 0, 0, 0);

      const now = Date.now();
      (npcMgr as any).npcThreat.set(npc.id, {
        lastAttackerEntityId: player.id,
        lastAggroAt: now,
        threatByEntityId: { [player.id]: 100 },
      });

      npcMgr.updateAll(250);

      assert.equal(npc.roomId, "prime_shard:1,0", "NPC should step one room toward target");
    },
  );
});

test("[contract] Train System v0.1: assist snap moves pack allies into pursuit room when enabled", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_STEP: "2",
      PW_TRAIN_SOFT_LEASH: "25",
      PW_TRAIN_HARD_LEASH: "40",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TRAIN_MAX_ROOMS_FROM_SPAWN: "2",
      PW_TRAIN_ASSIST_ENABLED: "1",
      PW_TRAIN_ASSIST_SNAP_ALLIES: "1",
    },
    () => {
      const spawnRoom = "prime_shard:0,0";
      const targetRoom = "prime_shard:2,0";

      const entities = new EntityManager();
      const npcMgr = new NpcManager(entities);

      const leaderState = npcMgr.spawnNpcById("coward_rat", spawnRoom, 0, 0, 0);
      const allyState = npcMgr.spawnNpcById("coward_rat", spawnRoom, 1, 0, 0);

      assert.ok(leaderState && allyState, "Both NPCs should spawn");

      const leader = entities.get((leaderState as any).entityId) as any;
      const ally = entities.get((allyState as any).entityId) as any;

      assert.ok(leader && ally, "Entities should exist");
      assert.equal(leader.roomId, spawnRoom);
      assert.equal(ally.roomId, spawnRoom);

      const player = entities.createPlayerForSession("sess_train_assist", targetRoom) as any;

      const now = Date.now();
      (npcMgr as any).npcThreat.set(leader.id, {
        lastAttackerEntityId: player.id,
        lastAggroAt: now,
        threatByEntityId: { [player.id]: 100 },
      });

      npcMgr.updateAll(250);

      assert.equal(leader.roomId, "prime_shard:1,0", "Leader should pursue into next room");
      assert.equal(ally.roomId, "prime_shard:1,0", "Ally should snap into pursuit room");
    },
  );
});
