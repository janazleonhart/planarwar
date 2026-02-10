// worldcore/test/contract_townSanctuary_guardRecaptureSweep.test.ts
//
// Guard recapture sweep: when enabled on a town sanctuary region, guards should
// step out to engage nearby hostiles once no breach is active.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";

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

test("[contract] town sanctuary guardRecaptureSweep makes guards step toward nearby hostiles", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TRAIN_STEP: "1",
      PW_TRAIN_SOFT_LEASH: "10",
      PW_TRAIN_HARD_LEASH: "15",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
    },
    () => {
      try {
        // Sanctuary town tile at 0,0 with sweep enabled; adjacent tile (1,0) is outside.
        // (Match the canonical override shape used by other region-flag contract tests.)
        setRegionFlagsTestOverrides({
          prime_shard: {
            "0,0": {
              rules: {
                ai: {
                  townSanctuary: true,
                  townSanctuaryGuardSortie: true,
                  townSanctuaryGuardSortieRangeTiles: 1,
                  guardRecaptureSweep: true,
                },
              },
            },
          },
        });

        const entities = new EntityManager();
        const npcMgr = new NpcManager(entities);

        const townRoom = "prime_shard:0,0";
        const outsideRoom = "prime_shard:1,0";

        const guardSt = npcMgr.spawnNpcById("town_guard", townRoom, 0, 0, 0);
        assert.ok(guardSt, "Guard should spawn");
        const guard = entities.get((guardSt as any).entityId) as any;
        assert.ok(guard, "Guard entity should exist");

        // Hostile just outside the sanctuary.
        const hostileSt = npcMgr.spawnNpcById("rat_pack_raider", outsideRoom, 0, 0, 0);
        assert.ok(hostileSt, "Hostile should spawn");
        const hostile = entities.get((hostileSt as any).entityId) as any;
        assert.ok(hostile, "Hostile entity should exist");

        // Tick: sweep should seed threat and move the guard one tile toward the hostile.
        npcMgr.updateAll(250);

        // Either the guard moved to 1,0 or (at minimum) has seeded threat against the hostile.
        const guardRoom = String((guard as any).roomId ?? "");
        const threat = (npcMgr as any).npcThreat.get(guard.id);
        const table = (threat?.threatByEntityId ?? {}) as Record<string, number>;

        assert.ok(
          guardRoom === outsideRoom || Object.keys(table).includes(String(hostile.id)),
          "Guard should move toward or target the nearby hostile",
        );
      } finally {
        setRegionFlagsTestOverrides(null);
      }
    },
  );
});

test.after(() => {
  setRegionFlagsTestOverrides(null);
});
