// worldcore/test/regionFlags_provider.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  clearRegionFlagsCache,
  getRegionFlags,
  setRegionFlagsTestOverrides,
} from "../world/RegionFlags";

test("RegionFlags: test overrides return flags without touching DB", async () => {
  clearRegionFlagsCache();
  setRegionFlagsTestOverrides({
    prime_shard: {
      "0,0": { combatEnabled: false, pvpEnabled: true, dangerScalar: 2 },
    },
  });

  const f1 = await getRegionFlags("prime_shard", "0,0");
  assert.equal(f1.combatEnabled, false);
  assert.equal(f1.pvpEnabled, true);
  assert.equal(f1.dangerScalar, 2);

  // Also works if caller passes shard-prefixed region id.
  const f2 = await getRegionFlags("prime_shard", "prime_shard:0,0");
  assert.equal(f2.combatEnabled, false);
});

test("RegionFlags: changing overrides clears cache for determinism", async () => {
  clearRegionFlagsCache();

  setRegionFlagsTestOverrides({
    prime_shard: { "1,1": { combatEnabled: false } },
  });

  const a = await getRegionFlags("prime_shard", "1,1");
  assert.equal(a.combatEnabled, false);

  // If cache wasn't cleared, we'd incorrectly keep the old value.
  setRegionFlagsTestOverrides({
    prime_shard: { "1,1": { combatEnabled: true } },
  });

  const b = await getRegionFlags("prime_shard", "1,1");
  assert.equal(b.combatEnabled, true);
});

test("RegionFlags: clearing overrides returns empty flags", async () => {
  clearRegionFlagsCache();
  setRegionFlagsTestOverrides(null);

  const f = await getRegionFlags("prime_shard", "0,0");
  assert.deepEqual(f, {});
});
