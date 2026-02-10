// worldcore/test/contract_regionFlags_townSanctuary_guardSortie.test.ts

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

test("[contract] regions.flags townSanctuaryGuardSortie lets guards step out to engage nearby hostile threats", () => {
  withEnv(
    {
      PW_TRAIN_ENABLED: "1",
      PW_TRAIN_ROOMS_ENABLED: "1",
      PW_TRAIN_STEP: "2",
      PW_TRAIN_SOFT_LEASH: "25",
      PW_TRAIN_HARD_LEASH: "40",
      PW_TRAIN_PURSUE_TIMEOUT_MS: "20000",
      PW_TRAIN_MAX_ROOMS_FROM_SPAWN: "5",
      PW_TRAIN_ASSIST_ENABLED: "0",
      PW_TRAIN_ASSIST_SNAP_ALLIES: "0",
    },
    () => {
      // Sanctuary town tile at 0,0 with guard sortie enabled; adjacent tile (1,0) is outside.
      setRegionFlagsTestOverrides({
        prime_shard: {
          "0,0": {
            rules: {
              ai: {
                townSanctuary: true,
                townSanctuaryGuardSortie: true,
                townSanctuaryGuardSortieRangeTiles: 1,
              },
            },
          },
        },
      });

      try {
        const townRoom = "prime_shard:0,0";
        const outsideRoom = "prime_shard:1,0";

        const entities = new EntityManager();
        const npcs = new NpcManager(entities);

        const guardState = npcs.spawnNpcById("town_guard", townRoom, 0, 0, 0);
        assert.ok(guardState, "Guard should spawn");

        const hostileState = npcs.spawnNpcById("rat_pack_raider", outsideRoom, 0, 0, 0);
        assert.ok(hostileState, "Hostile should spawn");

        const guardEnt = entities.get((guardState as any).entityId) as any;
        const hostileEnt = entities.get((hostileState as any).entityId) as any;
        assert.ok(guardEnt && hostileEnt, "Entities should exist");

        const player = entities.createPlayerForSession("sess_guard_sortie", outsideRoom) as any;
        assert.ok(player, "Player should exist");

        // Hostile is actively fighting a player outside town.
        const now = Date.now();
        (npcs as any).npcThreat.set(hostileEnt.id, {
          lastAttackerEntityId: player.id,
          lastAggroAt: now,
          threatByEntityId: { [player.id]: 50 },
        });

        // Tick: guard should notice nearby hostile-with-player-threat and step out.
        npcs.updateAll(250);

        assert.equal(
          guardEnt.roomId,
          outsideRoom,
          "Guard should sortie out of sanctuary to engage the nearby hostile",
        );

        const guardThreat = (npcs as any).npcThreat.get(guardEnt.id) as any;
        const table = (guardThreat && guardThreat.threatByEntityId) || {};
        assert.ok(
          typeof table[hostileEnt.id] === "number" && table[hostileEnt.id] > 0,
          "Guard should seed threat onto the hostile NPC",
        );
      } finally {
        setRegionFlagsTestOverrides(null);
      }
    },
  );
});
