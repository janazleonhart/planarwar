//web-backend/test/cityMudBridge.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { deriveCityMudConsumers, deriveVendorEconomyRecommendation, deriveVendorSupportPolicy, summarizeCityMudBridge } from "../domain/cityMudBridge";
import { applyMissionConsumerGuidance, generateMissionOffers } from "../domain/missions";
import { createInitialPublicInfrastructureState } from "../domain/publicInfrastructure";
import { getOrCreatePlayerState } from "../gameState";

function makePlayer() {
  const ps = getOrCreatePlayerState(`citymud_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  ps.publicInfrastructure = createInitialPublicInfrastructureState("2026-03-16T00:00:00.000Z");
  return ps;
}

test("city-mud bridge summary exposes surplus-driven vendor supply when city is healthy", () => {
  const ps = makePlayer();
  ps.resources.food = 260;
  ps.resources.materials = 240;
  ps.resources.wealth = 220;
  ps.resources.mana = 100;
  ps.resources.knowledge = 80;
  ps.resources.unity = 70;
  ps.city.stats.infrastructure = 72;
  ps.city.stats.prosperity = 68;
  ps.city.stats.security = 62;
  ps.cityStress.total = 12;
  ps.cityStress.stage = "stable";

  const summary = summarizeCityMudBridge(ps);
  const consumers = deriveCityMudConsumers(summary);
  const vendorSupply = summary.hooks.find((hook) => hook.key === "vendor_supply");

  assert.ok(vendorSupply);
  assert.equal(summary.bridgeBand, "open");
  assert.equal(summary.recommendedPosture, "supportive");
  assert.ok(summary.supportCapacity >= 60);
  assert.ok((summary.exportableResources.materials ?? 0) > 0);
  assert.equal(vendorSupply?.direction, "up");
  assert.equal(consumers.vendorSupply.state, "abundant");
  assert.match(consumers.vendorSupply.headline, /vendor lanes can lean on city surplus/i);
});

test("city-mud bridge summary becomes defensive under frontier and civic pressure", () => {
  const ps = makePlayer();
  ps.cityStress.total = 84;
  ps.cityStress.stage = "lockdown";
  ps.regionWar[0].threat = 90;
  ps.regionWar[1].threat = 66;
  ps.publicInfrastructure.serviceHeat = 78;
  ps.activeMissions.push({
    instanceId: "mission_bridge_a",
    startedAt: "2026-03-16T00:00:00.000Z",
    finishesAt: "2026-03-16T03:00:00.000Z",
    mission: {
      id: "mission_bridge_a",
      kind: "army",
      difficulty: "high",
      title: "Hold the ridge",
      description: "Test mission",
      regionId: "ancient_elwynn",
      recommendedPower: 120,
      expectedRewards: { materials: 20 },
      risk: { casualtyRisk: "Severe" },
    },
  });
  if (ps.armies[0]) ps.armies[0].status = "on_mission";

  const summary = summarizeCityMudBridge(ps);
  const consumers = deriveCityMudConsumers(summary);
  const caravanRisk = summary.hooks.find((hook) => hook.key === "caravan_risk");
  const publicDrag = summary.hooks.find((hook) => hook.key === "public_service_drag");

  assert.equal(summary.bridgeBand, "restricted");
  assert.equal(summary.recommendedPosture, "defensive");
  assert.ok(summary.frontierPressure >= 60);
  assert.ok(summary.stabilityPressure >= 65);
  assert.ok(caravanRisk && caravanRisk.score >= 60);
  assert.ok(publicDrag && publicDrag.score > 0);
  assert.equal(consumers.missionBoard.state, "restricted");
  assert.equal(consumers.civicServices.state, "restricted");
  assert.ok(consumers.advisories.length >= 3);
  assert.match(summary.note, /under real pressure/i);
});

test("city-mud consumers degrade to pressured when support lanes are middling but not collapsed", () => {
  const ps = makePlayer();
  ps.resources.food = 170;
  ps.resources.materials = 155;
  ps.resources.wealth = 145;
  ps.city.stats.infrastructure = 52;
  ps.city.stats.prosperity = 44;
  ps.city.stats.security = 39;
  ps.cityStress.total = 42;
  ps.cityStress.stage = "strained";
  ps.publicInfrastructure.serviceHeat = 44;
  ps.publicInfrastructure.receipts.push({
    id: 'receipt_bridge_test',
    service: 'building_upgrade',
    mode: 'npc_public',
    permitTier: 'standard',
    levy: { wealth: 6 },
    queueMinutes: 18,
    strainScore: 41,
    createdAt: '2026-03-16T01:00:00.000Z',
    note: 'test receipt',
  });

  const summary = summarizeCityMudBridge(ps);
  const consumers = deriveCityMudConsumers(summary);

  assert.equal(summary.bridgeBand, 'strained');
  assert.equal(consumers.vendorSupply.state, 'pressured');
  assert.equal(consumers.civicServices.state, 'pressured');
  assert.match(consumers.civicServices.recommendedAction, /show visible civic friction/i);
});


test("mission offers inherit pressured support guidance when bridge posture is strained", () => {
  const ps = makePlayer();
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
  const offers = generateMissionOffers({ city: ps.city, heroes: ps.heroes, armies: ps.armies });
  const guided = applyMissionConsumerGuidance(offers, summary, consumers);

  assert.equal(summary.bridgeBand, "strained");
  assert.ok(guided.length > 0);
  assert.ok(guided.every((offer) => offer.supportGuidance));
  assert.ok(guided.some((offer) => offer.supportGuidance?.state === "pressured"));
  assert.match(guided[0]?.risk.notes ?? "", /mission support is available with visible drag/i);
});

test("mission offers inherit restricted support guidance when bridge posture is defensive", () => {
  const ps = makePlayer();
  ps.cityStress.total = 84;
  ps.cityStress.stage = "lockdown";
  ps.regionWar[0].threat = 90;
  ps.publicInfrastructure.serviceHeat = 78;
  ps.activeMissions.push({
    instanceId: "mission_bridge_b",
    startedAt: "2026-03-16T00:00:00.000Z",
    finishesAt: "2026-03-16T03:00:00.000Z",
    mission: {
      id: "mission_bridge_b",
      kind: "army",
      difficulty: "high",
      title: "Hold the ridge",
      description: "Test mission",
      regionId: "ancient_elwynn",
      recommendedPower: 120,
      expectedRewards: { materials: 20 },
      risk: { casualtyRisk: "Severe" },
    },
  });

  const summary = summarizeCityMudBridge(ps);
  const consumers = deriveCityMudConsumers(summary);
  const offers = generateMissionOffers({ city: ps.city, heroes: ps.heroes, armies: ps.armies });
  const guided = applyMissionConsumerGuidance(offers, summary, consumers);

  assert.equal(summary.bridgeBand, "restricted");
  assert.ok(guided.every((offer) => offer.supportGuidance?.state === "restricted"));
  assert.match(guided[0]?.supportGuidance?.recommendedAction ?? "", /escort, defense, recovery/i);
});


test("vendor support policy expands when bridge surplus is healthy", () => {
  const ps = makePlayer();
  ps.resources.food = 260;
  ps.resources.materials = 240;
  ps.resources.wealth = 220;
  ps.resources.mana = 100;
  ps.resources.knowledge = 80;
  ps.resources.unity = 70;
  ps.city.stats.infrastructure = 72;
  ps.city.stats.prosperity = 68;
  ps.city.stats.security = 62;
  ps.cityStress.total = 12;
  ps.cityStress.stage = "stable";

  const summary = summarizeCityMudBridge(ps);
  const consumers = deriveCityMudConsumers(summary);
  const policy = deriveVendorSupportPolicy(summary, consumers);

  assert.equal(policy.state, "abundant");
  assert.equal(policy.stockPosture, "expand");
  assert.equal(policy.cadencePosture, "accelerate");
  assert.ok(policy.recommendedStockMultiplier > 1);
});

test("vendor support policy throttles when bridge posture is strained", () => {
  const ps = makePlayer();
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
  const policy = deriveVendorSupportPolicy(summary, consumers);

  assert.equal(summary.bridgeBand, "strained");
  assert.equal(policy.state, "pressured");
  assert.equal(policy.stockPosture, "throttle");
  assert.equal(policy.pricePosture, "caution");
  assert.ok(policy.recommendedRestockCadenceMultiplier > 1);
});


test("vendor economy recommendation applies bridge policy to concrete knobs", () => {
  const ps = makePlayer();
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
  const policy = deriveVendorSupportPolicy(summary, consumers);
  const rec = deriveVendorEconomyRecommendation(
    {
      stockMax: 80,
      restockEverySec: 300,
      restockAmount: 6,
      priceMinMult: 0.9,
      priceMaxMult: 1.6,
    },
    policy,
  );

  assert.equal(policy.state, "pressured");
  assert.ok(rec.stockMax < 80);
  assert.ok(rec.restockEverySec > 300);
  assert.ok(rec.priceMinMult >= 0.9);
  assert.ok(rec.priceMaxMult >= 1.6);
  assert.equal(rec.restockPerHour, Math.ceil((rec.restockAmount * 3600) / rec.restockEverySec));
});
