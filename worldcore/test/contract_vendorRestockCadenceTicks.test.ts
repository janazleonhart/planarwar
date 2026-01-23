// worldcore/test/contract_vendorRestockCadenceTicks.test.ts
//
// Contract: restock cadence tick math stays stable.
// Mirrors PostgresVendorService SQL semantics (ticks, last_restock_ts advancement, and stock cap).

import test from "node:test";
import assert from "node:assert/strict";

import { computeVendorRestockCadence } from "../vendors/VendorTypes";

test("[contract] vendor restock cadence: ticks are floored and lastRestock advances by whole ticks", () => {
  const r = computeVendorRestockCadence({
    stock: 10,
    stockMax: 50,
    lastRestockMs: 0,
    nowMs: 901_000, // 901s
    restockEverySec: 300,
    restockAmount: 2,
  });

  assert.equal(r.tickSec, 300);
  assert.equal(r.tickAmount, 2);
  assert.equal(r.ticks, 3);
  assert.equal(r.newStock, 16); // 10 + 3*2
  assert.equal(r.newLastRestockMs, 900_000); // 0 + 3*300s
});

test("[contract] vendor restock cadence: full stock still advances lastRestock (prevents perpetual DUE)", () => {
  const r = computeVendorRestockCadence({
    stock: 50,
    stockMax: 50,
    lastRestockMs: 0,
    nowMs: 901_000,
    restockEverySec: 300,
    restockAmount: 2,
  });

  assert.equal(r.ticks, 3);
  assert.equal(r.newStock, 50); // capped
  assert.equal(r.newLastRestockMs, 900_000); // STILL advances
});

test("[contract] vendor restock cadence: legacy restockPerHour approximates cadence", () => {
  // restockPerHour=30 -> tickSec=floor(3600/30)=120, tickAmount=1
  const r = computeVendorRestockCadence({
    stock: 0,
    stockMax: 50,
    lastRestockMs: 0,
    nowMs: 241_000,
    restockPerHour: 30,
  });

  assert.equal(r.tickSec, 120);
  assert.equal(r.tickAmount, 1);
  assert.equal(r.ticks, 2);
  assert.equal(r.newStock, 2);
  assert.equal(r.newLastRestockMs, 240_000);
});
