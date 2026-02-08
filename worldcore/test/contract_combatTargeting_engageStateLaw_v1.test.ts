// worldcore/test/contract_combatTargeting_engageStateLaw_v1.test.ts
//
// Contract: Engage State Law v1 centralizes combat target validity.
// - Stealthed players are invalid targets.
// - Service-protected entities are invalid targets.
// - Out-of-room targets are invalid unless allowCrossRoom is enabled.

import test from "node:test";
import assert from "node:assert/strict";

import { EntityManager } from "../core/EntityManager";
import { isValidCombatTarget } from "../combat/CombatTargeting";
import { applyStatusEffectToEntity } from "../combat/StatusEffects";

test("[contract] combatTargeting: stealth denies engage (Engage State Law v1)", () => {
  const entities = new EntityManager();
  const now = 1000;

  const npc = { id: "npc.1", type: "npc", roomId: "prime_shard:0,0", hp: 10, alive: true } as any;
  const player = entities.createPlayerForSession("s1", "prime_shard:0,0") as any;
  player.id = "player.1";
  player.hp = 10;
  player.alive = true;

  applyStatusEffectToEntity(
    player,
    {
      id: "test_stealth",
      name: "Stealth",
      tags: ["stealth"],
      durationMs: 60_000,
      modifiers: {},
    },
    now,
  );

  const v = isValidCombatTarget({
    now,
    attacker: npc,
    target: player,
    attackerRoomId: npc.roomId,
    allowCrossRoom: false,
  });

  assert.equal(v.ok, false);
  assert.equal((v as any).reason, "stealth");
});

test("[contract] combatTargeting: service-protected entities are invalid targets", () => {
  const now = 1000;

  const npc = { id: "npc.1", type: "npc", roomId: "prime_shard:0,0", hp: 10, alive: true } as any;
  const target = {
    id: "svc.1",
    type: "npc",
    roomId: "prime_shard:0,0",
    hp: 999,
    alive: true,
    isServiceProvider: true,
  } as any;

  const v = isValidCombatTarget({
    now,
    attacker: npc,
    target,
    attackerRoomId: npc.roomId,
    allowCrossRoom: false,
  });

  assert.equal(v.ok, false);
  assert.equal((v as any).reason, "protected");
});

test("[contract] combatTargeting: out-of-room invalid unless allowCrossRoom", () => {
  const now = 1000;

  const npc = { id: "npc.1", type: "npc", roomId: "prime_shard:0,0", hp: 10, alive: true } as any;
  const target = { id: "player.1", type: "player", roomId: "prime_shard:1,0", hp: 10, alive: true } as any;

  const v1 = isValidCombatTarget({
    now,
    attacker: npc,
    target,
    attackerRoomId: npc.roomId,
    allowCrossRoom: false,
  });
  assert.equal(v1.ok, false);
  assert.equal((v1 as any).reason, "out_of_room");

  const v2 = isValidCombatTarget({
    now,
    attacker: npc,
    target,
    attackerRoomId: npc.roomId,
    allowCrossRoom: true,
  });
  assert.equal(v2.ok, true);
});
