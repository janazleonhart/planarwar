// worldcore/test/regionFlagsPvpDuelOnlyMode.test.ts
//
// Lane J2 (behavioral):
// Prove RegionFlags duel-only PvP mode requires inDuel=true.

import test from "node:test";
import assert from "node:assert/strict";

import { canDamage } from "../combat/DamagePolicy";
import { setRegionFlagsTestOverrides } from "../world/RegionFlags";

function makeChar(id: string) {
  return { id, shardId: "prime_shard", name: id } as any;
}

test("[behavior] RegionFlags pvpMode=duelOnly blocks PvP when not in duel", async () => {
  setRegionFlagsTestOverrides(null);

  try {
    setRegionFlagsTestOverrides({
      prime_shard: {
        "0,0": {
          combatEnabled: true,
          pvpEnabled: true,
          // Important: match your RegionPvpMode union values.
          pvpMode: "duelOnly" as any,
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
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});

test("[behavior] RegionFlags pvpMode=duelOnly allows PvP when in duel", async () => {
  setRegionFlagsTestOverrides(null);

  try {
    setRegionFlagsTestOverrides({
      prime_shard: {
        "0,0": {
          combatEnabled: true,
          pvpEnabled: true,
          pvpMode: "duelOnly" as any,
        },
      },
    });

    const attacker = { entity: { id: "p1", name: "Attacker" }, char: makeChar("p1") };
    const defender = { entity: { id: "p2", name: "Defender" }, char: makeChar("p2") };

    const res = await canDamage(attacker, defender, {
      shardId: "prime_shard",
      regionId: "prime_shard:0,0",
      inDuel: true,
    });

    assert.equal(res.allowed, true);
    assert.ok((res as any).mode === "pvp" || (res as any).mode === "duel");
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});
