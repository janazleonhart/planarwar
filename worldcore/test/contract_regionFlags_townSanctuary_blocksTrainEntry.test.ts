// worldcore/test/contract_regionFlags_townSanctuary_blocksTrainEntry.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete (process.env as any)[k];
    else (process.env as any)[k] = v;
  }

  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  }
}

test("[contract] regions.flags rules.ai.townSanctuary blocks Train room pursuit from entering (non-guards)", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_STEP: "2",
      PW_TRAIN_SOFT_LEASH: "25",
      PW_TRAIN_HARD_LEASH: "40",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TRAIN_MAX_ROOMS_FROM_SPAWN: "5",
      PW_TRAIN_ASSIST_ENABLED: "0",
      PW_TRAIN_ASSIST_SNAP_ALLIES: "0",
    },
    () => {
      // Mark the would-be next tile as a town sanctuary.
      setRegionFlagsTestOverrides({
        prime_shard: {
          "1,0": { rules: { ai: { townSanctuary: true } } },
        },
      });

      try {
        const spawnRoom = "prime_shard:0,0";
        const targetRoom = "prime_shard:2,0";

        const entities = new EntityManager();
        const npcMgr = new NpcManager(entities);

        const npcState = npcMgr.spawnNpcById("coward_rat", spawnRoom, 0, 0, 0);
        assert.ok(npcState, "NPC should spawn");

        const npc = entities.get((npcState as any).entityId) as any;
        assert.ok(npc, "NPC entity should exist");
        assert.equal(npc.roomId, spawnRoom);

        const player = entities.createPlayerForSession("sess_town_sanctuary", targetRoom) as any;

        const now = Date.now();
        (npcMgr as any).npcThreat.set(npc.id, {
          lastAttackerEntityId: player.id,
          lastAggroAt: now,
          threatByEntityId: { [player.id]: 100 },
        });

        npcMgr.updateAll(250);

        // Without sanctuary, the NPC would step to prime_shard:1,0.
        assert.equal(npc.roomId, spawnRoom, "NPC should NOT enter sanctuary region via Train pursuit");

        const threat = (npcMgr as any).npcThreat.get(npc.id) as any;
        const table = (threat && threat.threatByEntityId) || {};
        assert.equal(Object.keys(table).length, 0, "Threat should be cleared when sanctuary blocks entry");
      } finally {
        setRegionFlagsTestOverrides(null);
      }
    },
  );
});
