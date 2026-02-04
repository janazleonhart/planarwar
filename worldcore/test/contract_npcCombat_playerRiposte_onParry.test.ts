// worldcore/test/contract_npcCombat_playerRiposte_onParry.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleNpcCounterAttack } from "../combat/NpcCombat";

function makeSeqRng(seq: number[]): () => number {
  let i = 0;
  return () => {
    const v = seq[Math.min(i, seq.length - 1)];
    i += 1;
    return v;
  };
}

test("[contract] NpcCombat: player parry can trigger a single riposte counter-swing", async () => {
  // Arrange: simple entities.
  const npc: any = { id: "n1", name: "Goblin", hp: 50, maxHp: 50, alive: true };
  const player: any = { id: "p1", name: "Player", hp: 100, maxHp: 100, alive: true };

  // ctx.session.character is used for defender level/defense skill.
  const ctx: any = {
    session: {
      identity: { userId: "u1" },
      character: {
        id: "char_1",
        shardId: "prime_shard",
        level: 1,
        // Keep defense skill minimal; avoidance is driven by rng below.
        defenseSkillPoints: 0,
      },
    },
  };

  // Force outcome sequence inside resolvePhysicalHit (NPC -> player):
  // rHit then rAvoid.
  // - rHit must be <= hitChance to avoid "miss"
  // - rAvoid must be > dodgeEdge but < parryEdge to produce "parry"
  // At low levels dodgeEdge is ~0.03ish, parryEdge ~0.05ish.
  const rng = makeSeqRng([
    0.0, 0.04, // NPC swing: hit + parry
    0.0, 0.99, // Player riposte: hit (no dodge/parry/block)
    0.0,       // CombatEngine variance roll (0.8x)
  ]);

  const line = await applySimpleNpcCounterAttack(ctx, npc, player, { rng });

  assert.ok(line, "expected a combat line");
  assert.match(line!, /parry/i, "should mention parry");

  // Ensure we do not produce infinite chains: only one riposte token.
  const riposteMentions = (line!.match(/riposte/i) ?? []).length;
  assert.ok(riposteMentions <= 1, "must not mention riposte more than once");

  // Riposte should use real weapon damage (greater than chip damage).
  const m = line!.match(/riposte\s+[^\n]*?\s+for\s+(\d+)\s+damage/i);
  assert.ok(m, "should include riposte damage number");
  const dmg = Number(m![1]);
  assert.ok(Number.isFinite(dmg) && dmg >= 2, `riposte damage should be >= 2, got ${dmg}`);

});
