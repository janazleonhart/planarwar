// worldcore/test/contract_regionFlagsNoDbInTests.test.ts
//
// Lane K (contract):
// In WORLDCORE_TEST, RegionFlags must not perform DB I/O.
// This protects the test suite from hangs and from needing Postgres creds.
//
// We assert this by importing RegionFlags and invoking the normal read path.
// In test runtime, RegionFlags should use test overrides / in-memory provider only.

import test from "node:test";
import assert from "node:assert/strict";

import { setRegionFlagsTestOverrides, getRegionFlags } from "../world/RegionFlags";

test("[contract] RegionFlags does not require DB in tests", async () => {
  // If this suite is running via the normal harness, WORLDCORE_TEST=1 is already set.
  // We avoid asserting the env directly so this test also works in ad-hoc runs.

  setRegionFlagsTestOverrides(null);

  try {
    setRegionFlagsTestOverrides({
      prime_shard: {
        "0,0": { combatEnabled: true, pvpEnabled: false },
      },
    });

    // If RegionFlags tried to hit DB here, tests would hang or throw.
    const flags = await getRegionFlags("prime_shard", "prime_shard:0,0");

    assert.ok(flags, "Expected flags object");
    assert.equal(flags.combatEnabled, true);
    assert.equal(flags.pvpEnabled, false);
  } finally {
    setRegionFlagsTestOverrides(null);
  }
});
