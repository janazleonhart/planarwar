// worldcore/test/contract_npcCombat_counterattack_blockMitigation.test.ts
//
// Contract: NPC counter-attack treats block as partial mitigation (reduced damage),
// not a full avoid, and can be tested deterministically via injected RNG.
//
// NOTE: computeNpcMeleeDamage() uses Math.random internally (via entityCombat). This
// contract keeps determinism by patching Math.random *inside an async test* so restore
// occurs after awaited work completes.

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

test("[contract] NpcCombat: counter-attack block reduces damage deterministically", async () => {
  const oldRandom = Math.random;
  try {
    // Make computeNpcMeleeDamage deterministic: roll = 0.8 + 0 * 0.4
    Math.random = () => 0;

    const player: any = { id: "p1", name: "Hero", hp: 100, maxHp: 100, alive: true };
    const npc: any = { id: "n1", name: "Goblin", maxHp: 100, hp: 100, alive: true, attackPower: 10 };

    const char: any = { id: "c1", name: "Hero", level: 10, shardId: "prime_shard" };

    const ctx: any = {
      session: { character: char },
      // No npc manager: keep the counter-attack path simple for this contract.
    };

    // Force:
    // - hit check passes (0.01)
    // - avoid roll lands in the "block" band (0.08 at L10 is inside ~[0.075, 0.093))
    const line = await applySimpleNpcCounterAttack(ctx, npc, player, {
      rng: rngSeq([0.01, 0.08]),
    });

    assert.ok(line);
    assert.match(line, /block/i);

    // base = attackPower(10), roll=0.8 => 8
    // blockMultiplier defaults to 0.7 => floor(8 * 0.7) = 5
    assert.equal(player.hp, 95);
    assert.match(line, /take 5 damage/i);
  } finally {
    Math.random = oldRandom;
  }
});
