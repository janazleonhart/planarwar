// worldcore/test/contract_npcManager_packAssist_respectsStealth.test.ts
//
// Contract: pack assist must respect Engage State Law visibility.
// If the offender is stealthed (tag: stealth), allies should NOT seed threat or snap-move.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { NpcManager } from "../npc/NpcManager";
import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";
import { getThreatValue } from "../npc/NpcThreat";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

test("[contract] npcManager: pack assist does not seed threat onto stealthed offender", () => {
  const realNow = Date.now;

  try {
    // Freeze base time for deterministic tick clock init.
    Date.now = () => 1000;

    const entities = new EntityManager();
    const npcs = new NpcManager(entities);

    const attacker = entities.createPlayerForSession("sess1", "prime_shard:0,0") as any;

    // Give the attacker stealth so Engage State Law invalidates them.
    applyStatusEffectToEntity(
      attacker,
      {
        id: "test_stealth",
        name: "Stealth",
        tags: ["stealth"],
        durationMs: 60_000,
        modifiers: {},
      },
      1000,
    );

    const leader = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 0, 0, 0);
    const ally = npcs.spawnNpc(DEFAULT_NPC_PROTOTYPES.coward_rat, "prime_shard:0,0", 1, 0, 0);

    // Initialize tick clock
    npcs.updateAll(0);

    // Record threat on leader; ally should NOT assist due to stealth validity gating.
    npcs.recordDamage(leader.entityId, attacker.id, 30);

    const allyThreat = (npcs as any).npcThreat.get(ally.entityId);
    if (!allyThreat) {
      assert.ok(true, "ally threat may be absent when assist is skipped");
      return;
    }

    const v = getThreatValue(allyThreat, attacker.id);
    assert.equal(v, 0, "ally threat should not seed onto stealthed offender");
  } finally {
    Date.now = realNow;
  }
});
