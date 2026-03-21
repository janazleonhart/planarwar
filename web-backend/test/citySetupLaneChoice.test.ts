//web-backend/test/citySetupLaneChoice.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { createInitialPlayerState } from "../gameState/gameStateCore";
import { defaultPolicies, tickPlayerState } from "../gameState";
import { seedWorld } from "../domain/world";
import { buildCityRuntimeSnapshot, applyCityRuntimeSnapshot } from "../gameState/cityRuntimeSnapshot";
import { applySettlementLaneBootstrap, normalizeSettlementLaneChoice } from "../routes/playerCityAccess";
import { buildCitySummary, buildSettlementLaneChoice, buildSettlementLaneProfile } from "../routes/me";
import { getCityProductionPerTick } from "../domain/city";

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

test("black market lane bootstrap applies crooked founding posture", () => {
  const ps = createInitialPlayerState("tester", seedWorld(), defaultPolicies);
  const baseline = {
    wealth: ps.resources.wealth,
    knowledge: ps.resources.knowledge,
    materials: ps.resources.materials,
    unity: ps.resources.unity,
    prosperity: ps.city.stats.prosperity,
    influence: ps.city.stats.influence,
    security: ps.city.stats.security,
    stability: ps.city.stats.stability,
    cityUnity: ps.city.stats.unity,
    stressTotal: ps.cityStress.total,
    threatPressure: ps.cityStress.threatPressure,
    unityPressure: ps.cityStress.unityPressure,
    eventCount: ps.eventLog.length,
  };

  applySettlementLaneBootstrap(ps, "black_market");

  assert.equal(ps.city.settlementLane, "black_market");
  assert.equal(ps.cityStress.stage, "strained");
  assert.equal(ps.cityStress.total, Math.max(baseline.stressTotal, 33));
  assert.equal(ps.cityStress.threatPressure, Math.max(baseline.threatPressure, 8));
  assert.equal(ps.cityStress.unityPressure, Math.max(baseline.unityPressure, 6));

  assert.equal(ps.resources.wealth, baseline.wealth + 18);
  assert.equal(ps.resources.knowledge, baseline.knowledge + 4);
  assert.equal(ps.resources.materials, baseline.materials + 6);
  assert.equal(ps.resources.unity, Math.max(0, baseline.unity - 2));

  assert.equal(ps.city.stats.prosperity, baseline.prosperity + 6);
  assert.equal(ps.city.stats.influence, baseline.influence + 8);
  assert.equal(ps.city.stats.security, Math.max(0, baseline.security - 8));
  assert.equal(ps.city.stats.stability, Math.max(0, baseline.stability - 5));
  assert.equal(ps.city.stats.unity, Math.max(0, baseline.cityUnity - 4));

  assert.equal(ps.eventLog.length, baseline.eventCount + 1);
  assert.equal(ps.eventLog.at(-1)?.kind, "city_morph");
});




test("settlement lanes apply distinct passive production after founding", () => {
  const civic = createInitialPlayerState("civic", seedWorld(), defaultPolicies);
  const shadow = createInitialPlayerState("shadow", seedWorld(), defaultPolicies);

  const civicProduction = getCityProductionPerTick(civic.city);

  applySettlementLaneBootstrap(shadow, "black_market");
  const shadowProduction = getCityProductionPerTick(shadow.city);

  // Assert the lane-driven delta, not a hardcoded seeded baseline.
  assert.equal(civic.city.settlementLane, "city");
  assert.equal(shadow.city.settlementLane, "black_market");

  assert.equal(shadowProduction.food ?? 0, (civicProduction.food ?? 0) - 1);
  assert.equal(shadowProduction.unity ?? 0, (civicProduction.unity ?? 0) - 1);
  assert.equal(shadowProduction.wealth ?? 0, (civicProduction.wealth ?? 0) + 2);
  assert.equal(shadowProduction.knowledge ?? 0, (civicProduction.knowledge ?? 0) + 1);
});

test("settlement lane profile describes city and black-market starts distinctly", () => {
  const civic = buildSettlementLaneProfile("city");
  const shadow = buildSettlementLaneProfile("black_market");

  assert.equal(civic.id, "city");
  assert.equal(shadow.id, "black_market");
  assert.ok(civic.strengths.some((entry) => /standard civic baseline/i.test(entry)));
  assert.ok(civic.strengths.some((entry) => /passive civic surplus of food and unity/i.test(entry)));
  assert.ok(shadow.strengths.some((entry) => /extra wealth, materials, and knowledge/i.test(entry)));
  assert.ok(shadow.strengths.some((entry) => /passive shadow surplus/i.test(entry)));
  assert.ok(shadow.liabilities.some((entry) => /strained early posture/i.test(entry)));
});


test("city summary exposes settlement lane production breakdown", () => {
  const civic = createInitialPlayerState("lane-civic", seedWorld(), defaultPolicies);
  const shadow = createInitialPlayerState("lane-shadow", seedWorld(), defaultPolicies);
  applySettlementLaneBootstrap(shadow, "black_market");

  const civicSummary = buildCitySummary(civic);
  const shadowSummary = buildCitySummary(shadow);

  assert.equal(civicSummary.productionBreakdown.settlementLane.foodPerTick, 1);
  assert.equal(civicSummary.productionBreakdown.settlementLane.unityPerTick, 1);
  assert.equal(civicSummary.productionBreakdown.settlementLane.wealthPerTick, 0);
  assert.equal(civicSummary.productionBreakdown.settlementLane.knowledgePerTick, 0);

  assert.equal(shadowSummary.productionBreakdown.settlementLane.foodPerTick, 0);
  assert.equal(shadowSummary.productionBreakdown.settlementLane.unityPerTick, 0);
  assert.equal(shadowSummary.productionBreakdown.settlementLane.wealthPerTick, 2);
  assert.equal(shadowSummary.productionBreakdown.settlementLane.knowledgePerTick, 1);

  assert.equal(
    civicSummary.production.foodPerTick,
    civicSummary.productionBreakdown.buildings.foodPerTick + civicSummary.productionBreakdown.settlementLane.foodPerTick
  );
  assert.equal(
    civicSummary.production.unityPerTick,
    civicSummary.productionBreakdown.buildings.unityPerTick + civicSummary.productionBreakdown.settlementLane.unityPerTick
  );
  assert.equal(
    shadowSummary.production.wealthPerTick,
    shadowSummary.productionBreakdown.buildings.wealthPerTick + shadowSummary.productionBreakdown.settlementLane.wealthPerTick
  );
  assert.equal(
    shadowSummary.production.knowledgePerTick,
    shadowSummary.productionBreakdown.buildings.knowledgePerTick + shadowSummary.productionBreakdown.settlementLane.knowledgePerTick
  );
});


test("city summary exposes a canonical settlement lane founding receipt", () => {
  const civic = createInitialPlayerState("lane-receipt-civic", seedWorld(), defaultPolicies);
  const shadow = createInitialPlayerState("lane-receipt-shadow", seedWorld(), defaultPolicies);
  applySettlementLaneBootstrap(shadow, "black_market");

  const civicSummary = buildCitySummary(civic);
  const shadowSummary = buildCitySummary(shadow);

  assert.match(civicSummary.settlementLaneReceipt.title, /city founding posture/i);
  assert.match(shadowSummary.settlementLaneReceipt.title, /black market founding posture/i);
  assert.ok(civicSummary.settlementLaneReceipt.effects.some((entry) => /standard civic baseline/i.test(entry)));
  assert.ok(civicSummary.settlementLaneReceipt.effects.some((entry) => /passive civic surplus of food and unity/i.test(entry)));
  assert.ok(shadowSummary.settlementLaneReceipt.effects.some((entry) => /extra wealth, materials, and knowledge/i.test(entry)));
});


test("settlement lanes emit distinct passive receipts after enough ticks", () => {
  const civic = createInitialPlayerState("lane-receipt-civic-tick", seedWorld(), defaultPolicies);
  const shadow = createInitialPlayerState("lane-receipt-shadow-tick", seedWorld(), defaultPolicies);
  applySettlementLaneBootstrap(shadow, "black_market");

  const advanceCivicTo = new Date(new Date(civic.lastTickAt).getTime() + 5 * 60_000);
  const advanceShadowTo = new Date(new Date(shadow.lastTickAt).getTime() + 5 * 60_000);

  tickPlayerState(civic, advanceCivicTo);
  tickPlayerState(shadow, advanceShadowTo);

  assert.match(civic.eventLog.at(-1)?.message ?? "", /Civic surplus kept the city steady \(\+5 food, \+5 unity\)\./i);
  assert.match(shadow.eventLog.at(-1)?.message ?? "", /Shadow surplus skimmed extra returns \(\+10 wealth, \+5 knowledge\)\./i);
});


test("settlement lane setup choices expose exact preview deltas", () => {
  const civic = buildSettlementLaneChoice("city");
  const shadow = buildSettlementLaneChoice("black_market");

  assert.equal(civic.preview.foundingResources.wealth, 0);
  assert.equal(civic.preview.passivePerTick.food, 1);
  assert.equal(civic.preview.passivePerTick.unity, 1);
  assert.equal(civic.preview.pressureFloor.stage, "steady");
  assert.ok(civic.preview.runtimeAccess.some((entry) => /outside pressure/i.test(entry)));

  assert.equal(shadow.preview.foundingResources.wealth, 18);
  assert.equal(shadow.preview.foundingResources.materials, 6);
  assert.equal(shadow.preview.foundingResources.knowledge, 4);
  assert.equal(shadow.preview.foundingResources.unity, -2);
  assert.equal(shadow.preview.foundingStats.prosperity, 6);
  assert.equal(shadow.preview.foundingStats.influence, 8);
  assert.equal(shadow.preview.foundingStats.security, -8);
  assert.equal(shadow.preview.passivePerTick.wealth, 2);
  assert.equal(shadow.preview.passivePerTick.knowledge, 1);
  assert.equal(shadow.preview.pressureFloor.stage, "strained");
  assert.equal(shadow.preview.pressureFloor.total, 33);
  assert.ok(shadow.preview.runtimeAccess.some((entry) => /black-market world consequence windows/i.test(entry)));
});
