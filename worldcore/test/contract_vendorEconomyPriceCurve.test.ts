// worldcore/test/contract_vendorEconomyPriceCurve.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { computeVendorUnitPriceGold } from "../vendors/VendorTypes";

test("[contract] vendor economy price curve is monotonic with scarcity", () => {
  const base = 100;
  const minMult = 0.85;
  const maxMult = 1.5;
  const stockMax = 50;

  const atFull = computeVendorUnitPriceGold(base, stockMax, stockMax, minMult, maxMult);
  const atHalf = computeVendorUnitPriceGold(base, 25, stockMax, minMult, maxMult);
  const atLow = computeVendorUnitPriceGold(base, 5, stockMax, minMult, maxMult);
  const atZero = computeVendorUnitPriceGold(base, 0, stockMax, minMult, maxMult);

  assert.ok(atFull <= atHalf, `expected full<=half, got ${atFull} vs ${atHalf}`);
  assert.ok(atHalf <= atLow, `expected half<=low, got ${atHalf} vs ${atLow}`);
  assert.ok(atLow <= atZero, `expected low<=zero, got ${atLow} vs ${atZero}`);

  // Boundaries: atFull ~= base*minMult, atZero ~= base*maxMult (rounded)
  assert.ok(atFull >= Math.floor(base * minMult) - 1);
  assert.ok(atZero <= Math.ceil(base * maxMult) + 1);
});

test("[contract] vendor economy ignores stock if stockMax is invalid", () => {
  assert.equal(computeVendorUnitPriceGold(10, 0, 0, 0.85, 1.5), 10);
  assert.equal(computeVendorUnitPriceGold(10, null as any, null as any, 0.85, 1.5), 10);
});
