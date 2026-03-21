//web-backend/test/worldConsequenceConsumers.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import { deriveWorldConsequenceConsumers, applyWorldConsequenceVendorPolicy } from "../domain/worldConsequenceConsumers";
import { pushWorldConsequence } from "../domain/worldConsequences";
import { deriveCityMudConsumers, deriveVendorSupportPolicy, summarizeCityMudBridge } from "../domain/cityMudBridge";
import { applyMissionConsumerGuidance } from "../domain/missions";

test("quiet world consequence consumers leave vendor policy unchanged", () => {
  const ps = getOrCreatePlayerState("world_consequence_consumers_quiet_player");
  ps.worldConsequences = [];
  ps.worldConsequenceState = {
    regions: [],
    worldEconomy: { tradePressure: 0, supplyFriction: 0, cartelAttention: 0, destabilization: 0, outlook: "stable" },
    blackMarket: { opportunityScore: 0, heat: 0, outlook: "quiet" },
    factionPressure: { driftScore: 0, instability: 0, dominantStance: "stable" },
    summary: { affectedRegionIds: [], totalLedgerEntries: 0, severeCount: 0, destabilizationScore: 0, note: "No propagated consequence pressure yet." },
  };

  const bridgeSummary = summarizeCityMudBridge(ps);
  const bridgeConsumers = deriveCityMudConsumers(bridgeSummary);
  const basePolicy = deriveVendorSupportPolicy(bridgeSummary, bridgeConsumers);
  const consumers = deriveWorldConsequenceConsumers(ps);
  const overlaid = applyWorldConsequenceVendorPolicy(basePolicy, consumers);

  assert.equal(consumers.summary.pressureTier, "quiet");
  assert.deepEqual(overlaid, basePolicy);
});

test("active world consequence consumers tighten vendor policy and mission guidance", () => {
  const ps = getOrCreatePlayerState("world_consequence_consumers_hot_player");
  ps.city.settlementLane = "black_market";

  ps.currentOffers = [
    {
      id: "world_consequence_offer_a",
      kind: "army",
      difficulty: "high",
      title: "Hold the Fractured Crossroads",
      description: "Raiders and smugglers are choking the supply route.",
      regionId: ps.city.regionId,
      recommendedPower: 140,
      expectedRewards: { wealth: 35, materials: 25, food: 12 },
      risk: { casualtyRisk: "high", notes: "Heavy pressure on the road." },
      responseTags: ["frontline", "command"],
      threatFamily: "organized_hostile_forces",
      targetingPressure: 74,
      targetingReasons: ["Trade routes are under direct pressure."],
    },
    {
      id: "world_consequence_offer_b",
      kind: "hero",
      difficulty: "medium",
      title: "Trace the Smuggling Brokers",
      description: "Cartel brokers are using the disruption window to move goods.",
      regionId: ps.city.regionId,
      recommendedPower: 80,
      expectedRewards: { wealth: 22, materials: 8, influence: 10 },
      risk: { casualtyRisk: "moderate", heroInjuryRisk: "moderate", notes: "The brokers are protected." },
      responseTags: ["recon", "command"],
      threatFamily: "organized_hostile_forces",
      targetingPressure: 61,
      targetingReasons: ["Black-market opportunity is rising."],
    },
  ] as any;

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Crossroads fracture",
    summary: "Trade disruption and cartel attention surged.",
    detail: "This should feed downstream consumer overlays, not just dashboards.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["trade_disruption", "black_market_opening", "faction_drift", "world_economy_hook"],
    metrics: { pressureDelta: 18, recoveryDelta: 6, controlDelta: -5, threatDelta: 8 },
    outcome: "failure",
  });

  const bridgeSummary = summarizeCityMudBridge(ps);
  const bridgeConsumers = deriveCityMudConsumers(bridgeSummary);
  const basePolicy = deriveVendorSupportPolicy(bridgeSummary, bridgeConsumers);
  const consumers = deriveWorldConsequenceConsumers(ps);
  const overlaid = applyWorldConsequenceVendorPolicy(basePolicy, consumers);
  const offers = applyMissionConsumerGuidance(ps.currentOffers.slice(0, 2), bridgeSummary, bridgeConsumers, consumers);

  assert.ok(["watch", "active", "severe"].includes(consumers.summary.pressureTier));
  assert.ok(consumers.vendor.stockMultiplierDelta < 0);
  assert.ok(consumers.vendor.cadenceDelta > 0);
  assert.ok(overlaid.recommendedStockMultiplier <= Math.max(basePolicy.recommendedStockMultiplier, 1.3));
  assert.ok(overlaid.recommendedRestockCadenceMultiplier >= basePolicy.recommendedRestockCadenceMultiplier || consumers.summary.pressureTier === "watch");
  assert.equal(offers.length, 2);
  assert.ok(offers.every((offer) => (offer.supportGuidance?.severity ?? 0) >= 4));
  assert.ok(offers.some((offer) => offer.supportGuidance?.detail.includes("pressure")));
});
