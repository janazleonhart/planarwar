// worldcore/test/contract_regionFlags_townSanctuary_recapturePushout.test.ts

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

test("[contract] town sanctuary recapture pushes hostile NPCs out after breach ends (no breach active)", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TRAIN_STEP: "2",
      PW_TRAIN_MAX_ROOMS_FROM_SPAWN: "5",
      PW_TRAIN_ASSIST_ENABLED: "0",
      PW_TRAIN_ASSIST_SNAP_ALLIES: "0",
    },
    () => {
      // Mark the current tile as sanctuary.
      setRegionFlagsTestOverrides({
        prime_shard: {
          "0,0": { rules: { ai: { townSanctuary: true } } },
        },
      });

      try {
        const sanctuaryRoom = "prime_shard:0,0";
        const outsideRoom = "prime_shard:1,0";

        const entities = new EntityManager();
        const npcMgr = new NpcManager(entities);

        const npcState = npcMgr.spawnNpcById("coward_rat", sanctuaryRoom, 0, 0, 0);
        assert.ok(npcState, "NPC should spawn");

        const npc = entities.get((npcState as any).entityId) as any;
        assert.ok(npc, "NPC entity should exist");
        assert.equal(npc.roomId, sanctuaryRoom);

        // Force a spawnRoomId outside the sanctuary so the recapture logic has a destination.
        const st = (npcMgr as any).npcsByEntityId.get(npc.id) as any;
        assert.ok(st, "NPC runtime state should exist");
        st.spawnRoomId = outsideRoom;

        npcMgr.updateAll(250);

        assert.equal(
          npc.roomId,
          outsideRoom,
          "NPC should be pushed out of sanctuary toward spawn when no breach is active",
        );
      } finally {
        setRegionFlagsTestOverrides(null);
      }
    },
  );
});
