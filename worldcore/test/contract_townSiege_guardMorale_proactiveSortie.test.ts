// worldcore/test/contract_townSiege_guardMorale_proactiveSortie.test.ts

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

test("[contract] Town Siege: guard morale can proactively sortie to recently-aggressive hostiles during siege", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TOWN_SIEGE_GUARD_MORALE_PROACTIVE: "1",
      PW_TOWN_SIEGE_GUARD_MORALE_RECENT_AGGRO_WINDOW_MS: "20000",
    },
    () => {
      setRegionFlagsTestOverrides({
        prime_shard: {
          "0,0": { rules: { ai: { townSanctuary: true, townSanctuaryGuardSortie: true, townSanctuaryGuardSortieRangeTiles: 1 } } },
        },
      });

      try {
        const entities = new EntityManager();
        const npcMgr = new NpcManager(entities);

        // Fake siege active in the sanctuary.
        const now = Date.now();
        (npcMgr as any).townSiege = {
          isUnderSiege: (roomId: string, at: number) => roomId === "prime_shard:0,0" && at >= now,
        };

        const guardRoom = "prime_shard:0,0";
        const hostileRoom = "prime_shard:1,0";

        const guardState = npcMgr.spawnNpcById("town_guard", guardRoom, 0, 0, 0) as any;
        assert.ok(guardState, "Guard should spawn");

        const hostileState = npcMgr.spawnNpcById("coward_rat", hostileRoom, 0, 0, 0) as any;
        assert.ok(hostileState, "Hostile should spawn");

        const guardEnt = entities.get(String(guardState.entityId)) as any;
        const hostileEnt = entities.get(String(hostileState.entityId)) as any;

        assert.equal(guardEnt.roomId, guardRoom);
        assert.equal(hostileEnt.roomId, hostileRoom);

        // Simulate the hostile having been aggressive recently (no player threat table needed).
        hostileEnt.inCombat = true;
        (npcMgr as any).npcThreat.set(hostileEnt.id, {
          lastAggroAt: now,
          lastAttackerEntityId: null,
          threatByEntityId: {},
        });

        npcMgr.updateAll(250);

        assert.equal(guardEnt.roomId, hostileRoom, "Guard should sortie to engage the hostile under siege morale");

        const guardThreat = (npcMgr as any).npcThreat.get(guardEnt.id) as any;
        const table = (guardThreat && guardThreat.threatByEntityId) || {};
        assert.ok(table[String(hostileEnt.id)] >= 100, "Guard should seed threat onto the hostile");
      } finally {
        setRegionFlagsTestOverrides(null);
      }
    },
  );
});
