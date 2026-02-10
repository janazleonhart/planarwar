// worldcore/test/contract_regionFlags_npcAggro_retaliateOnly.test.ts
//
// Contract: regions.flags can disable proactive NPC aggro via rules.ai.npcAggro = "retaliate_only".
// In this mode:
//  - Aggressive NPCs do NOT initiate combat against nearby players.
//  - If a player attacks first (threat recorded), the NPC retaliates normally.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";

function makeWorld(opts?: { roomId?: string }) {
  const roomId = opts?.roomId ?? "prime_shard:0,0";

  // Force deterministic test mode behavior.
  process.env.WORLDCORE_TEST = "1";

  // Region flags: tutorial belt / safe hub behavior.
  setRegionFlagsTestOverrides({
    prime_shard: {
      // Note: overrides accept DB-style ids ("0,0") or room ids ("prime_shard:0,0").
      "0,0": {
        rules: {
          ai: {
            npcAggro: "retaliate_only",
          },
        },
      },
    },
  });

  const entities = new EntityManager();
  const npcs = new NpcManager(entities);

  // Player entity (no SessionManager needed for this contract).
  const player = entities.createPlayerForSession("s1", roomId) as any;
  player.name = "Tester";
  player.hp = 100;
  player.maxHp = 100;
  player.alive = true;

  // Aggressive NPC (must be aggressive so the retaliation contract is meaningful).
  const npc = npcs.spawnNpcById("rat_pack_raider", roomId, 0, 0, 0);
  assert.ok(npc, "expected rat_pack_raider npc to spawn for contract test");

  return { roomId, entities, npcs, player, npc };
}

test("[contract] regions.flags npcAggro=retaliate_only prevents proactive aggro", () => {
  const { npcs, player } = makeWorld({ roomId: "prime_shard:0,0" });

  // Let NPC AI tick several times.
  for (let i = 0; i < 10; i++) {
    npcs.updateAll(200);
  }

  assert.equal(player.hp, 100, "player should take no damage without initiating combat");
});

test("[contract] regions.flags npcAggro=retaliate_only still retaliates after being attacked", () => {
  const { npcs, player, npc } = makeWorld({ roomId: "prime_shard:0,0" });

  // Player attacks first: record threat on the NPC.
  npcs.recordDamage(npc.entityId, player.id, 10);

  // Let NPC tick until it retaliates.
  for (let i = 0; i < 10; i++) {
    npcs.updateAll(200);
    if (player.hp < 100) break;
  }

  assert.ok(player.hp < 100, "player should take damage after initiating combat");
});
