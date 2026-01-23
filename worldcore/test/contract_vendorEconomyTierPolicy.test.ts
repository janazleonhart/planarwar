// worldcore/test/contract_vendorEconomyTierPolicy.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  getVendorEconomyPolicyForTier,
  tryInferTownTierFromIdToken,
} from "../world/TownTierRules";

test("[contract] vendor economy tier policy clamps and is monotonic", () => {
  const p0 = getVendorEconomyPolicyForTier(0);
  const p1 = getVendorEconomyPolicyForTier(1);
  const p2 = getVendorEconomyPolicyForTier(2);
  const p3 = getVendorEconomyPolicyForTier(3);
  const p4 = getVendorEconomyPolicyForTier(4);
  const p5 = getVendorEconomyPolicyForTier(5);
  const p6 = getVendorEconomyPolicyForTier(999);

  // Clamp behavior
  assert.equal(p0.tier, 1);
  assert.equal(p6.tier, 5);

  // Stock caps should generally increase with tier
  assert.ok(p1.stockMax < p2.stockMax);
  assert.ok(p2.stockMax < p3.stockMax);
  assert.ok(p3.stockMax < p4.stockMax);
  assert.ok(p4.stockMax < p5.stockMax);

  // Restock cadence should generally speed up with tier
  assert.ok(p1.restockEverySec > p2.restockEverySec);
  assert.ok(p2.restockEverySec > p3.restockEverySec);
  assert.ok(p3.restockEverySec > p4.restockEverySec);
  assert.ok(p4.restockEverySec > p5.restockEverySec);

  // Higher tiers should not have harsher max price pressure than lower tiers
  assert.ok(p1.priceMaxMult >= p2.priceMaxMult);
  assert.ok(p2.priceMaxMult >= p3.priceMaxMult);
  assert.ok(p3.priceMaxMult >= p4.priceMaxMult);
  assert.ok(p4.priceMaxMult >= p5.priceMaxMult);

  // Sanity: bounds
  for (const p of [p1, p2, p3, p4, p5]) {
    assert.ok(p.stockMax > 0);
    assert.ok(p.restockEverySec > 0);
    assert.ok(p.restockAmount > 0);
    assert.ok(p.priceMinMult > 0);
    assert.ok(p.priceMaxMult > 0);
    assert.ok(p.priceMinMult <= p.priceMaxMult);
  }
});

test("[contract] infer tier token from vendor id", () => {
  assert.equal(tryInferTownTierFromIdToken("starter_alchemist_tier3"), 3);
  assert.equal(tryInferTownTierFromIdToken("starter_alchemist-tier4"), 4);
  assert.equal(tryInferTownTierFromIdToken("tier_2_vendor"), 2);
  assert.equal(tryInferTownTierFromIdToken("nope"), null);
});
