// worldcore/test/contract_regionFlags_townSanctuary_pressureSiegeEvent.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";
import { WorldEventBus } from "../world/WorldEventBus";

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

test("[contract] town sanctuary pressure emits town.sanctuary.siege event once threshold is reached", () => {
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

      // Make pressure threshold tiny for deterministic contract.
      PW_TOWN_SANCTUARY_PRESSURE_WINDOW_MS: "60000",
      PW_TOWN_SANCTUARY_PRESSURE_THRESHOLD: "3",
      PW_TOWN_SANCTUARY_PRESSURE_COOLDOWN_MS: "0",
    },
    () => {
      setRegionFlagsTestOverrides({
        prime_shard: {
          "1,0": { rules: { ai: { townSanctuary: true } } },
        },
      });

      try {
        const spawnRoom = "prime_shard:0,0";
        const targetRoom = "prime_shard:2,0";
        const sanctuaryRoom = "prime_shard:1,0";

        const entities = new EntityManager();
        const npcMgr = new NpcManager(entities);

        const bus = new WorldEventBus();
        npcMgr.attachEventBus(bus);

        let siegeCount = 0;
        let lastPayload: any = null;
        bus.on("town.sanctuary.siege", (payload) => {
          siegeCount += 1;
          lastPayload = payload;
        });

        const npcState = npcMgr.spawnNpcById("coward_rat", spawnRoom, 0, 0, 0);
        assert.ok(npcState, "NPC should spawn");

        const npc = entities.get((npcState as any).entityId) as any;
        assert.ok(npc, "NPC entity should exist");

        const player = entities.createPlayerForSession("sess_sanctuary_pressure", targetRoom) as any;

        // Each time the NPC tries to step into the sanctuary, it is blocked and threat is cleared.
        // Re-seed threat 3 times to hit the pressure threshold deterministically.
        for (let i = 0; i < 3; i++) {
          const now = Date.now() + i;
          (npcMgr as any).npcThreat.set(npc.id, {
            lastAttackerEntityId: player.id,
            lastAggroAt: now,
            threatByEntityId: { [player.id]: 100 },
          });

          npcMgr.updateAll(250);
        }

        assert.equal(siegeCount, 1, "Expected a single siege event emission at threshold");
        assert.ok(lastPayload, "Expected siege payload");
        assert.equal(lastPayload.roomId, sanctuaryRoom);
        assert.equal(lastPayload.pressureCount, 3);
      } finally {
        setRegionFlagsTestOverrides(null);
      }
    },
  );
});
