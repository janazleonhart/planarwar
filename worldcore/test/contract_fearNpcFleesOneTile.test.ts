// worldcore/test/contract_fearNpcFleesOneTile.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

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

test("[contract] fear: NPC flees one room tile away from threat target when rooms enabled", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TRAIN_MAX_ROOMS_FROM_SPAWN: "50",
      PW_TRAIN_ASSIST_ENABLED: "0",
      PW_TRAIN_ASSIST_SNAP_ALLIES: "0",
    },
    () => {
      const entities = new EntityManager();
      const npcMgr = new NpcManager(entities);

      const spawnRoom = "prime_shard:0,0";
      const playerRoom = "prime_shard:1,0";

      const npcState = npcMgr.spawnNpcById("coward_rat", spawnRoom, 0, 0, 0);
      assert.ok(npcState);
      const npc = entities.get((npcState as any).entityId) as any;
      assert.ok(npc);

      const player = entities.createPlayerForSession("sess_fear", playerRoom) as any;
      assert.ok(player);

      const now = Date.now();
      (npcMgr as any).npcThreat.set(npc.id, {
        lastAttackerEntityId: player.id,
        lastAggroAt: now,
        threatByEntityId: { [player.id]: 100 },
      });

      applyStatusEffectToEntity(
        npc,
        {
          id: "test_fear",
          name: "Fear",
          durationMs: 10000,
          modifiers: {},
          tags: ["fear"],
        },
        now,
      );

      npcMgr.updateAll(250);

      assert.equal(npc.roomId, "prime_shard:-1,0", "NPC should flee away from player room");
    },
  );
});
