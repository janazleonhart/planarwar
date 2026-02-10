// worldcore/test/contract_regionFlags_townSanctuary_breachAllowsEntry.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";
import { WorldEventBus } from "../world/WorldEventBus";
import { TownSiegeService } from "../world/TownSiegeService";

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

test("[contract] town sanctuary breach (opt-in) allows Train pursuit to enter sanctuary tiles", () => {
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

      // Breach must be active and long-lived for the test.
      PW_TOWN_SANCTUARY_SIEGE_TTL_MS: "60000",
      PW_TOWN_SIEGE_BREACH_TTL_MS: "60000",
      PW_TOWN_SIEGE_BREACH_HITS: "1",
      PW_TOWN_SIEGE_BREACH_WINDOW_MS: "60000",
    },
    () => {
      // Mark the next tile as a sanctuary AND opt it in to breach behavior.
      setRegionFlagsTestOverrides({
        prime_shard: {
          "1,0": { rules: { ai: { townSanctuary: true, allowSiegeBreach: true } } },
        },
      });

      try {
        const spawnRoom = "prime_shard:0,0";
        const sanctuaryRoom = "prime_shard:1,0";
        const targetRoom = "prime_shard:2,0";

        const entities = new EntityManager();
        const npcMgr = new NpcManager(entities);

        const bus = new WorldEventBus();
        const siege = new TownSiegeService(bus);
        npcMgr.attachTownSiegeService(siege);

        // Force breach active for the sanctuary tile.
        bus.emit("town.sanctuary.siege", {
          shardId: "prime_shard",
          roomId: sanctuaryRoom,
          pressureCount: 99,
          windowMs: 15000,
        });

        assert.equal(siege.isBreachActive(sanctuaryRoom), true, "breach should be active for test");

        const npcState = npcMgr.spawnNpcById("coward_rat", spawnRoom, 0, 0, 0);
        assert.ok(npcState, "NPC should spawn");

        const npc = entities.get((npcState as any).entityId) as any;
        assert.ok(npc, "NPC entity should exist");
        assert.equal(npc.roomId, spawnRoom);

        const player = entities.createPlayerForSession("sess_breach", targetRoom) as any;

        const now = Date.now();
        (npcMgr as any).npcThreat.set(npc.id, {
          lastAttackerEntityId: player.id,
          lastAggroAt: now,
          threatByEntityId: { [player.id]: 100 },
        });

        npcMgr.updateAll(250);

        // With sanctuary breach active + allowSiegeBreach=true, the NPC may step into the sanctuary tile.
        assert.equal(npc.roomId, sanctuaryRoom, "NPC should be able to enter sanctuary tile when breach is active");

        const threat = (npcMgr as any).npcThreat.get(npc.id) as any;
        const table = (threat && threat.threatByEntityId) || {};
        assert.equal(Object.keys(table).length > 0, true, "Threat should NOT be cleared when breach allows entry");
      } finally {
        setRegionFlagsTestOverrides(null);
      }
    },
  );
});
