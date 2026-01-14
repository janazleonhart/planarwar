// worldcore/test/regionFlagsInfluenceDamagePolicy.test.ts
//
// Lane I (behavioral):
// Prove DamagePolicy.canDamage(...) consults RegionFlags by default
// when regionCombatEnabled is NOT explicitly provided.
//
// We stub RegionFlags via setRegionFlagsTestOverrides (no DB).

import test from "node:test";
import assert from "node:assert/strict";

import { canDamage } from "../combat/DamagePolicy";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";

function makeChar(id: string) {
  return { id, shardId: "prime_shard" } as any;
}

test("[behavior] RegionFlags combatEnabled=false blocks canDamage default path", async () => {
  // Ensure clean state even if a previous test set overrides.
  setRegionFlagsTestOverrides(null);

  try {
    // Stub region flags for this test region.
    setRegionFlagsTestOverrides({
      prime_shard: {
        // Accepts "0,0" (db-form) or "prime_shard:0,0" (prefixed).
        "0,0": { combatEnabled: false },
      },
    });

    const attacker = { entity: { id: "p1", name: "Attacker" }, char: makeChar("p1") };
    const defender = { entity: { id: "npc1", name: "Town Rat" } };

    // IMPORTANT: no regionCombatEnabled override here — we want the RegionFlags lookup.
    const res = await canDamage(attacker, defender, {
      shardId: "prime_shard",
      regionId: "prime_shard:0,0",
    });

    assert.equal(res.allowed, false);
    assert.ok(
      (res as any).reason?.toLowerCase().includes("combat is disabled"),
      `Expected "Combat is disabled..." reason, got: ${(res as any).reason}`,
    );
  } finally {
    // Always reset for other tests.
    setRegionFlagsTestOverrides(null);
  }
});

test("[behavior] RegionFlags combatEnabled=true allows canDamage default path", async () => {
  setRegionFlagsTestOverrides(null);

  try {
    setRegionFlagsTestOverrides({
      prime_shard: {
        "0,0": { combatEnabled: true },
      },
    });

    const attacker = { entity: { id: "p1", name: "Attacker" }, char: makeChar("p1") };
    const defender = { entity: { id: "npc1", name: "Town Rat" } };

    const res = await canDamage(attacker, defender, {
      shardId: "prime_shard",
      regionId: "prime_shard:0,0",
    });

    assert.equal(res.allowed, true);
    assert.equal((res as any).mode, "pve");
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});
