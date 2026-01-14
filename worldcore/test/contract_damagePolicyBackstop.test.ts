// worldcore/test/contract_damagePolicyBackstop.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import type { Entity } from "../shared/Entity";
import type { CharacterState } from "../characters/CharacterTypes";
import { applySimpleDamageToPlayer } from "../combat/entityCombat";

test("[contract] DamagePolicy backstop blocks PvP damage by default (fail-closed)", () => {
  const defenderEntity = {
    id: "defender_entity",
    type: "player",
    roomId: "prime_shard:0,0",
    hp: 100,
    maxHp: 100,
  } as any as Entity;

  const attackerChar = {
    id: "attacker_char",
    shardId: "prime_shard",
    roomId: "prime_shard:0,0",
    name: "Attacker",
  } as any as CharacterState;

  const defenderChar = {
    id: "defender_char",
    shardId: "prime_shard",
    roomId: "prime_shard:0,0",
    name: "Defender",
  } as any as CharacterState;

  const r = applySimpleDamageToPlayer(defenderEntity, 10, defenderChar, "physical", {
    mode: "pvp",
    attackerChar,
    shardId: "prime_shard",
    regionId: "prime_shard:0,0",
    regionPvpEnabled: false, // explicit fail-closed
  });

  assert.equal(r.killed, false);
  assert.equal(r.newHp, 100);
  assert.equal((defenderEntity as any).hp, 100);
});
