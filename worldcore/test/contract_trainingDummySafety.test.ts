// worldcore/test/contract_trainingDummySafety.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_NPC_PROTOTYPES } from "../npc/NpcTypes";
import { isProtectedNpc, recordNpcCrimeAgainst } from "../npc/NpcCrime";
import { applySimpleNpcCounterAttack } from "../combat/NpcCombat";

test("[contract] training dummies are law-exempt (guards should not react)", () => {
  const small = DEFAULT_NPC_PROTOTYPES.training_dummy;
  const big = DEFAULT_NPC_PROTOTYPES.training_dummy_big;

  assert.equal(isProtectedNpc(small), false, "training_dummy must NOT be protected");
  assert.equal(isProtectedNpc(big), false, "training_dummy_big must NOT be protected");
});

test("[contract] training dummy crime is not recorded on attacker", () => {
  const attacker: any = { id: "char_1", shardId: "prime_shard" };

  const npc: any = {
    entityId: "npc_1",
    protoId: "training_dummy_big",
    templateId: "training_dummy_big",
    roomId: "prime_shard:0,0",
    hp: 10000,
    maxHp: 10000,
    alive: true,
  };

  const res = recordNpcCrimeAgainst(npc, attacker, { newHp: 9999 });

  assert.equal(res, null, "no crime result should be produced for training dummy");
  assert.equal(
    attacker.recentCrimeUntil ?? 0,
    0,
    "attacker should NOT become wanted for hitting training dummies",
  );
});

test("[contract] training dummies never counter-attack (even the big one)", () => {
  const player: any = { id: "p1", name: "Player", hp: 100, maxHp: 100, alive: true };
  const dummy: any = { id: "n1", name: "Sturdy Training Dummy", hp: 10000, maxHp: 10000, alive: true };

  const ctx: any = {
    session: { character: { id: "char_1", shardId: "prime_shard" } },
    npcs: {
      getNpcStateByEntityId: (_id: string) => ({
        protoId: "training_dummy_big",
        templateId: "training_dummy_big",
      }),
    },
  };

  const before = player.hp;
  const line = applySimpleNpcCounterAttack(ctx, dummy, player);

  assert.equal(line, null, "counter-attack line must be null for training dummy");
  assert.equal(player.hp, before, "player HP must not change from dummy counter-attack");
});
