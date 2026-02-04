// worldcore/test/contract_npcCombat_npcRiposte_realDamage.test.ts
//
// Contract: NPC parry -> riposte applies real damage deterministically (no chain).
//
// This contract is intentionally self-contained: this repo does not use a shared
// worldcore/test/_support directory.

import test from "node:test";
import assert from "node:assert/strict";

import { performNpcAttack } from "../combat/NpcCombat";

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

test(
  "[contract] NpcCombat: npc parry->riposte applies real damage deterministically (no chain)",
  async () => {
    const oldRandom = Math.random;
    try {
      // Make computeNpcMeleeDamage deterministic: roll = 0.8 + 0 * 0.4
      Math.random = () => 0;

      const char: any = {
        id: "char_1",
        name: "Hero",
        shardId: "prime_shard",
        level: 10,
        // Stats.js requires attributes to exist.
        attributes: { str: 10, agi: 10, sta: 10, int: 10, spi: 10 },
        inventory: { items: [], gold: 0 },
      };

      const selfEntity: any = {
        id: "p1",
        name: "Hero",
        roomId: "prime_shard:0,0",
        hp: 100,
        maxHp: 100,
        alive: true,
      };

      const npc: any = {
        id: "n1",
        name: "Goblin",
        roomId: "prime_shard:0,0",
        hp: 100,
        maxHp: 100,
        alive: true,
        attackPower: 10,
      };

      const ctx: any = {
        session: { character: char },
      };

      // Force: player swing hits (rHit=0.0), then NPC parries (rAvoid in parry band).
      // Then NPC riposte hits cleanly.
      const rng = rngSeq([
        0.0,
        0.10,
        0.0,
        0.99,
      ]);

      const line = await performNpcAttack(ctx, char, selfEntity, npc, { rng });

      assert.match(line, /parr/i, "should mention parry/parries");
      assert.match(line, /riposte/i, "should mention riposte");
      assert.match(line, /hits you for 8 damage/i, "riposte should deal deterministic real damage");

      // No riposte chaining: should only include a single Riposte tag.
      const riposteCount = (line.match(/riposte/gi) ?? []).length;
      assert.equal(riposteCount, 1);
    } finally {
      Math.random = oldRandom;
    }
  },
);
