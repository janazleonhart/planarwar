// worldcore/test/serviceProtectionInvulnerable.test.ts
//
// Contract: invulnerable/protected entities take no damage.
// This guards staff/admin flags and prevents confusing "hit for X" results.

import test from "node:test";
import assert from "node:assert/strict";

import { applySimpleDamageToPlayer } from "../combat/entityCombat";
import { applySimpleNpcCounterAttack } from "../combat/NpcCombat";

test("[serviceProtection] applySimpleDamageToPlayer no-ops on invulnerable targets", () => {
  const ent: any = { id: "p1", name: "Invuln", maxHp: 100, hp: 100, invulnerable: true };
  const r = applySimpleDamageToPlayer(ent, 50);

  assert.equal(r.newHp, 100);
  assert.equal(ent.hp, 100);
  assert.equal(r.killed, false);
});

test("[serviceProtection] NPC counter-attack does nothing against invulnerable players", async () => {
  const ctx: any = { session: { character: { id: "p1", shardId: "prime_shard", level: 1 } } };
  const npc: any = { id: "n1", name: "Town Rat", maxHp: 10, hp: 10 };
  const player: any = { id: "p1", name: "Invuln", maxHp: 100, hp: 100, invulnerable: true };

  const msg = await applySimpleNpcCounterAttack(ctx, npc, player);
  assert.equal(msg, null);
  assert.equal(player.hp, 100);
});
