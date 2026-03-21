//web-backend/test/citySetupLaneChoice.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { createInitialPlayerState } from "../gameState/gameStateCore";
import { defaultPolicies } from "../gameState";
import { seedWorld } from "../domain/world";
import { buildCityRuntimeSnapshot, applyCityRuntimeSnapshot } from "../gameState/cityRuntimeSnapshot";
import { normalizeSettlementLaneChoice } from "../routes/playerCityAccess";

test("city setup lane choice defaults safely and accepts black market", () => {
  assert.equal(normalizeSettlementLaneChoice(undefined), "city");
  assert.equal(normalizeSettlementLaneChoice("CITY"), "city");
  assert.equal(normalizeSettlementLaneChoice("black_market"), "black_market");
  assert.equal(normalizeSettlementLaneChoice("underworld"), "city");
});

test("city runtime snapshot preserves settlement lane choice", () => {
  const ps = createInitialPlayerState("tester", seedWorld(), defaultPolicies);
  ps.city.settlementLane = "black_market";

  const snapshot = buildCityRuntimeSnapshot(ps);
  const restored = createInitialPlayerState("tester-2", seedWorld(), defaultPolicies);
  applyCityRuntimeSnapshot(restored, snapshot);

  assert.equal(restored.city.settlementLane, "black_market");
});
