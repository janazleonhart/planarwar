// worldcore/test/contract_npcManager_packAssist_usesTickNow.test.ts
//
// Contract: pack assist should stamp threat timestamps using the NpcManager tick clock
// (updateAll simulated time) rather than calling Date.now() inside updateThreatFromDamage.
// This keeps assist behavior deterministic and consistent with server tick time.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";

test("[contract] npcManager: pack assist stamps threat using tick clock (not Date.now)", () => {
  const realNow = Date.now;

  try {
    // 1) Freeze Date.now so updateAll initializes the simulated clock to a known value.
    Date.now = () => 1000;

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    // Attacker entity must exist for recordDamage paths.
    const attacker = entities.createPlayerForSession("sess1", "prime_shard:0,0");

    const leader = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 0, 0, 0);
    const ally = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 1, 0, 0);

    // Initialize tick clock
    npcs.updateAll(0);

    // 2) Now change Date.now to a totally different value. If pack assist uses Date.now
    // inside updateThreatFromDamage, lastAggroAt will be based on this new value.
    Date.now = () => 999_999;

    // Damage the leader; coward_rat has canCallHelp + groupId, so ally should get assist threat.
    npcs.recordDamage(leader.entityId, attacker.id, 1);

    const allyThreat = (npcs as any).npcThreat.get(ally.entityId);
    assert.ok(allyThreat, "ally threat should exist");

    assert.equal(allyThreat.lastAggroAt, 1000, "ally threat lastAggroAt should use tick clock");
  } finally {
    Date.now = realNow;
  }
});
