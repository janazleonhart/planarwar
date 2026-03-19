//web-backend/test/cityMudBridgeRegression.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveCityMudConsumers,
  deriveVendorGuardrailApplication,
  deriveVendorLanePolicy,
  deriveVendorPresetRecommendation,
  deriveVendorRuntimeEffect,
  deriveVendorSupportPolicy,
  describeVendorLaneSelection,
  matchesVendorLaneSelection,
  normalizeVendorLaneSelection,
  summarizeCityMudBridge,
} from "../domain/cityMudBridge";
import { createInitialPublicInfrastructureState } from "../domain/publicInfrastructure";
import { getOrCreatePlayerState } from "../gameState";

function makePlayer(seed: string) {
  const ps = getOrCreatePlayerState(`citymud_regression_${seed}_${Date.now()}`);
  ps.publicInfrastructure = createInitialPublicInfrastructureState("2026-03-16T00:00:00.000Z");
  return ps;
}

test("city-mud bridge summary exports remain callable through cityMudBridge barrel", () => {
  const ps = makePlayer("barrel");
  ps.resources.food = 220;
  ps.resources.materials = 210;
  ps.resources.wealth = 205;
  ps.resources.mana = 90;
  ps.city.stats.infrastructure = 68;
  ps.city.stats.prosperity = 61;
  ps.city.stats.security = 58;
  ps.cityStress.total = 18;
  ps.cityStress.stage = "stable";

  const summary = summarizeCityMudBridge(ps);
  const consumers = deriveCityMudConsumers(summary);
  const policy = deriveVendorSupportPolicy(summary, consumers);

  assert.equal(summary.bridgeBand, "open");
  assert.equal(consumers.vendorSupply.state, "abundant");
  assert.equal(policy.state, "abundant");
  assert.ok(Object.keys(summary.exportableResources).length > 0);
});

test("vendor lane policy keeps essentials safer than luxury under the same strained posture", () => {
  const ps = makePlayer("lanes");
  ps.resources.food = 170;
  ps.resources.materials = 155;
  ps.resources.wealth = 145;
  ps.city.stats.infrastructure = 52;
  ps.city.stats.prosperity = 44;
  ps.city.stats.security = 39;
  ps.cityStress.total = 42;
  ps.cityStress.stage = "strained";
  ps.publicInfrastructure.serviceHeat = 44;

  const summary = summarizeCityMudBridge(ps);
  const consumers = deriveCityMudConsumers(summary);
  const basePolicy = deriveVendorSupportPolicy(summary, consumers);
  const essentials = deriveVendorLanePolicy(summary, consumers, basePolicy, {
    itemId: "bread_bundle",
    itemName: "Bread Bundle",
    itemRarity: "common",
  });
  const luxury = deriveVendorLanePolicy(summary, consumers, basePolicy, {
    itemId: "silk_crown",
    itemName: "Silk Crown",
    itemRarity: "epic",
  });

  assert.equal(summary.bridgeBand, "strained");
  assert.equal(basePolicy.state, "pressured");
  assert.equal(essentials.lane, "essentials");
  assert.equal(luxury.lane, "luxury");
  assert.ok(essentials.recommendedStockMultiplier > luxury.recommendedStockMultiplier);
  assert.ok(essentials.recommendedPriceMaxMultiplier < luxury.recommendedPriceMaxMultiplier);
});

test("vendor preset recommendation stays null when the bridge posture is merely pressured without an explicit lane bias", () => {
  const recommendation = deriveVendorPresetRecommendation({
    policyState: "pressured",
    responsePhase: "watch",
    laneBias: "none",
  });

  assert.equal(recommendation, null);
});

test("vendor guardrails keep scarce runtime changes bounded and operator-gated", () => {
  const runtime = deriveVendorRuntimeEffect(
    {
      stock: 2,
      stockMax: 120,
      restockEverySec: 180,
      restockAmount: 14,
      priceMinMult: 0.8,
      priceMaxMult: 1.2,
    },
    {
      state: "restricted",
      stockPosture: "restrict",
      pricePosture: "surge_guard",
      cadencePosture: "triage",
      recommendedStockMultiplier: 0.3,
      recommendedPriceMinMultiplier: 1.35,
      recommendedPriceMaxMultiplier: 1.8,
      recommendedRestockCadenceMultiplier: 1.9,
      headline: "Restricted posture",
      detail: "Restricted bridge posture should behave defensively.",
      recommendedAction: "Require guardrails before applying changes.",
    },
  );

  const guarded = deriveVendorGuardrailApplication(
    {
      stockMax: 120,
      restockEverySec: 180,
      restockAmount: 14,
      priceMinMult: 0.8,
      priceMaxMult: 1.2,
    },
    runtime,
  );

  assert.equal(runtime.state, "scarce");
  assert.equal(guarded.autoApplyEligible, false);
  assert.ok(guarded.warnings.length > 0);
  assert.ok(guarded.priceMinMult <= guarded.priceMaxMult);
  assert.match(guarded.headline, /guardrails/i);
});


test("vendor lane selection helpers remain callable through cityMudBridge barrel", () => {
  const selected = normalizeVendorLaneSelection(["luxury", "essentials", "luxury", "bogus"]);
  assert.deepEqual(selected, ["luxury", "essentials"]);
  assert.equal(describeVendorLaneSelection(selected), "luxury, essentials lanes");
  assert.equal(describeVendorLaneSelection([]), "selected rows");
  assert.equal(matchesVendorLaneSelection({ lane: "luxury" }, selected), true);
  assert.equal(matchesVendorLaneSelection({ lane: "arcane" }, selected), false);
});
