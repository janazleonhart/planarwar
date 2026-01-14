// worldcore/test/regionFlagsPvpDisabledBlocksDamage.test.ts
//
// Lane J1 (behavioral):
// Prove RegionFlags can disable PvP via pvpEnabled=false.
// This tests DamagePolicy.canDamage default path (no explicit region override).

import test from "node:test";
import assert from "node:assert/strict";

import { canDamage } from "../combat/DamagePolicy";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";

function makeChar(id: string) {
  return { id, shardId: "prime_shard", name: id } as any;
}

test("[behavior] RegionFlags pvpEnabled=false blocks player->player damage", async () => {
  setRegionFlagsTestOverrides(null);

  try {
    setRegionFlagsTestOverrides({
      prime_shard: {
        "0,0": {
          combatEnabled: true,
          pvpEnabled: false,
        },
      },
    });

    const attacker = { entity: { id: "p1", name: "Attacker" }, char: makeChar("p1") };
    const defender = { entity: { id: "p2", name: "Defender" }, char: makeChar("p2") };

    const res = await canDamage(attacker, defender, {
      shardId: "prime_shard",
      regionId: "prime_shard:0,0",
      inDuel: false,
    });

    assert.equal(res.allowed, false);
    assert.ok(
      (res as any).reason?.toLowerCase().includes("pvp") ||
        (res as any).reason?.toLowerCase().includes("not allowed"),
      `Expected a PvP-related denial reason, got: ${(res as any).reason}`,
    );
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});
