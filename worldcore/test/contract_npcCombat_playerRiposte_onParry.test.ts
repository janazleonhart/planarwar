// worldcore/test/contract_npcCombat_playerRiposte_onParry.test.ts
//
// Contract: When a player parries an NPC counter-attack, the resolver may flag a riposte,
// and NpcCombat should perform a single immediate player riposte counter-swing.
//
// Safety rail (v1.1.x): player riposte is non-lethal until reactive kill/reward handling is unified.

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleNpcCounterAttack } from "../combat/NpcCombat";

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

test("[contract] NpcCombat: player parry can trigger a single riposte counter-swing", () => {
  const oldRandom = Math.random;
  try {
    // Make computeDamage deterministic (any internal rolls collapse to a fixed outcome).
    Math.random = () => 0;

    const player: any = { id: "p1", name: "Hero", hp: 100, maxHp: 100, alive: true };
    const npc: any = {
      id: "n1",
      name: "Goblin",
      level: 10,
      maxHp: 10,
      hp: 10,
      alive: true,
      armor: 0,
      attackPower: 10,
    };

    const char: any = {
      id: "c1",
      name: "Hero",
      level: 10,
      shardId: "prime_shard",
      // Skills are optional for this contract; riposte uses a conservative default.
    };

    const ctx: any = {
      session: { character: char },
      // No npc manager: keep the counter-attack path simple and mutation-based for this contract.
      items: undefined,
    };

    // RNG sequence consumed by PhysicalHitResolver:
    // NPC -> player swing:
    //   rHit=0.01 (hit check passes)
    //   rAvoid=0.06 (lands in parry band at L10)
    // Player riposte swing:
    //   rHit=0.01 (hit check passes)
    //   rAvoid=0.99 (no dodge/parry/block)
    const line = applySimpleNpcCounterAttack(ctx, npc, player, {
      rng: rngSeq([0.01, 0.06, 0.01, 0.99]),
    });

    assert.ok(line);
    assert.match(line as string, /You parry/i);
    assert.match(line as string, /Riposte!/i);

    // Parry avoids the incoming hit.
    assert.equal(player.hp, 100);

    // Riposte should deal damage, but must not kill the NPC in v1.1.x.
    assert.ok(npc.hp < 10, "riposte should reduce NPC HP");
    assert.ok(npc.hp >= 1, "riposte should not be lethal in v1.1.x");
  } finally {
    Math.random = oldRandom;
  }
});
