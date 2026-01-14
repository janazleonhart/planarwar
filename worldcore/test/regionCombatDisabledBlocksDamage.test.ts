// worldcore/test/regionCombatDisabledBlocksDamage.test.ts
//
// Lane H (behavioral):
// Verify that region combat disable blocks damage decisions deterministically,
// without touching DB/RegionFlags (safe under WORLDCORE_TEST=1).
//
// We do this by passing ctx.regionCombatEnabled=false into DamagePolicy.canDamage.
// That override must take precedence even in test runtime.

import test from "node:test";
import assert from "node:assert/strict";

import { canDamage } from "../combat/DamagePolicy";

function makeChar(id: string) {
  return { id, shardId: "prime_shard" } as any;
}

test("[behavior] region combat disabled blocks PvE (player -> NPC)", async () => {
  const attacker = { entity: { id: "p1" }, char: makeChar("p1") };
  const defender = { entity: { id: "npc1", name: "Town Rat" } };

  const res = await canDamage(attacker, defender, {
    shardId: "prime_shard",
    regionId: "prime_shard:0,0",
    regionCombatEnabled: false,
  });

  assert.equal(res.allowed, false);
  assert.ok(
    (res as any).reason?.toLowerCase().includes("combat is disabled"),
    `Expected "Combat is disabled..." reason, got: ${(res as any).reason}`,
  );
});

test("[behavior] region combat enabled allows PvE (player -> NPC)", async () => {
  const attacker = { entity: { id: "p1" }, char: makeChar("p1") };
  const defender = { entity: { id: "npc1", name: "Town Rat" } };

  const res = await canDamage(attacker, defender, {
    shardId: "prime_shard",
    regionId: "prime_shard:0,0",
    regionCombatEnabled: true,
  });

  assert.equal(res.allowed, true);
  assert.equal((res as any).mode, "pve");
});

test("[behavior] region combat disabled blocks NPC -> player as well", async () => {
  const attacker = { entity: { id: "npc1", name: "Town Rat" } };
  const defender = { entity: { id: "p1" }, char: makeChar("p1") };

  const res = await canDamage(attacker, defender, {
    shardId: "prime_shard",
    regionId: "prime_shard:0,0",
    regionCombatEnabled: false,
  });

  assert.equal(res.allowed, false);
});
