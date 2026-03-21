//web-backend/test/citySetupLaneChoice.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { createInitialPlayerState } from "../gameState/gameStateCore";
import { defaultPolicies, tickPlayerState } from "../gameState";
import { seedWorld } from "../domain/world";
import { buildCityRuntimeSnapshot, applyCityRuntimeSnapshot } from "../gameState/cityRuntimeSnapshot";
import { applySettlementLaneBootstrap, normalizeSettlementLaneChoice } from "../routes/playerCityAccess";
import { buildCitySummary, buildSettlementLaneChoice, buildSettlementLaneLatestReceipt, buildSettlementLaneProfile } from "../routes/me";
import { getSettlementLanePreferredActionOrder } from "../domain/worldConsequenceActions";
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
  assert.equal(civic.preview.pressureFloor.stage, "stable");
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

test("settlement lane setup preview matches applied bootstrap and passive truth", () => {
  const civicBaseline = createInitialPlayerState("preview-civic-baseline", seedWorld(), defaultPolicies);
  const civicApplied = createInitialPlayerState("preview-civic-applied", seedWorld(), defaultPolicies);
  const shadowBaseline = createInitialPlayerState("preview-shadow-baseline", seedWorld(), defaultPolicies);
  const shadowApplied = createInitialPlayerState("preview-shadow-applied", seedWorld(), defaultPolicies);

  const civicChoice = buildSettlementLaneChoice("city");
  const shadowChoice = buildSettlementLaneChoice("black_market");

  applySettlementLaneBootstrap(civicApplied, "city");
  applySettlementLaneBootstrap(shadowApplied, "black_market");

  assert.equal(civicApplied.resources.food - civicBaseline.resources.food, civicChoice.preview.foundingResources.food);
  assert.equal(civicApplied.resources.materials - civicBaseline.resources.materials, civicChoice.preview.foundingResources.materials);
  assert.equal(civicApplied.resources.wealth - civicBaseline.resources.wealth, civicChoice.preview.foundingResources.wealth);
  assert.equal(civicApplied.resources.mana - civicBaseline.resources.mana, civicChoice.preview.foundingResources.mana);
  assert.equal(civicApplied.resources.knowledge - civicBaseline.resources.knowledge, civicChoice.preview.foundingResources.knowledge);
  assert.equal(civicApplied.resources.unity - civicBaseline.resources.unity, civicChoice.preview.foundingResources.unity);

  assert.equal(shadowApplied.resources.food - shadowBaseline.resources.food, shadowChoice.preview.foundingResources.food);
  assert.equal(shadowApplied.resources.materials - shadowBaseline.resources.materials, shadowChoice.preview.foundingResources.materials);
  assert.equal(shadowApplied.resources.wealth - shadowBaseline.resources.wealth, shadowChoice.preview.foundingResources.wealth);
  assert.equal(shadowApplied.resources.mana - shadowBaseline.resources.mana, shadowChoice.preview.foundingResources.mana);
  assert.equal(shadowApplied.resources.knowledge - shadowBaseline.resources.knowledge, shadowChoice.preview.foundingResources.knowledge);
  assert.equal(shadowApplied.resources.unity - shadowBaseline.resources.unity, shadowChoice.preview.foundingResources.unity);

  assert.equal(civicApplied.city.stats.prosperity - civicBaseline.city.stats.prosperity, civicChoice.preview.foundingStats.prosperity);
  assert.equal(civicApplied.city.stats.influence - civicBaseline.city.stats.influence, civicChoice.preview.foundingStats.influence);
  assert.equal(civicApplied.city.stats.security - civicBaseline.city.stats.security, civicChoice.preview.foundingStats.security);
  assert.equal(civicApplied.city.stats.stability - civicBaseline.city.stats.stability, civicChoice.preview.foundingStats.stability);
  assert.equal(civicApplied.city.stats.unity - civicBaseline.city.stats.unity, civicChoice.preview.foundingStats.unity);

  assert.equal(shadowApplied.city.stats.prosperity - shadowBaseline.city.stats.prosperity, shadowChoice.preview.foundingStats.prosperity);
  assert.equal(shadowApplied.city.stats.influence - shadowBaseline.city.stats.influence, shadowChoice.preview.foundingStats.influence);
  assert.equal(shadowApplied.city.stats.security - shadowBaseline.city.stats.security, shadowChoice.preview.foundingStats.security);
  assert.equal(shadowApplied.city.stats.stability - shadowBaseline.city.stats.stability, shadowChoice.preview.foundingStats.stability);
  assert.equal(shadowApplied.city.stats.unity - shadowBaseline.city.stats.unity, shadowChoice.preview.foundingStats.unity);

  const civicSummary = buildCitySummary(civicApplied);
  const shadowSummary = buildCitySummary(shadowApplied);

  assert.equal(civicSummary.productionBreakdown.settlementLane.foodPerTick, civicChoice.preview.passivePerTick.food);
  assert.equal(civicSummary.productionBreakdown.settlementLane.materialsPerTick, civicChoice.preview.passivePerTick.materials);
  assert.equal(civicSummary.productionBreakdown.settlementLane.wealthPerTick, civicChoice.preview.passivePerTick.wealth);
  assert.equal(civicSummary.productionBreakdown.settlementLane.manaPerTick, civicChoice.preview.passivePerTick.mana);
  assert.equal(civicSummary.productionBreakdown.settlementLane.knowledgePerTick, civicChoice.preview.passivePerTick.knowledge);
  assert.equal(civicSummary.productionBreakdown.settlementLane.unityPerTick, civicChoice.preview.passivePerTick.unity);

  assert.equal(shadowSummary.productionBreakdown.settlementLane.foodPerTick, shadowChoice.preview.passivePerTick.food);
  assert.equal(shadowSummary.productionBreakdown.settlementLane.materialsPerTick, shadowChoice.preview.passivePerTick.materials);
  assert.equal(shadowSummary.productionBreakdown.settlementLane.wealthPerTick, shadowChoice.preview.passivePerTick.wealth);
  assert.equal(shadowSummary.productionBreakdown.settlementLane.manaPerTick, shadowChoice.preview.passivePerTick.mana);
  assert.equal(shadowSummary.productionBreakdown.settlementLane.knowledgePerTick, shadowChoice.preview.passivePerTick.knowledge);
  assert.equal(shadowSummary.productionBreakdown.settlementLane.unityPerTick, shadowChoice.preview.passivePerTick.unity);

  assert.equal(civicApplied.cityStress.stage, civicChoice.preview.pressureFloor.stage);
  assert.equal(civicApplied.cityStress.total, civicChoice.preview.pressureFloor.total);
  assert.equal(civicApplied.cityStress.threatPressure, civicChoice.preview.pressureFloor.threatPressure);
  assert.equal(civicApplied.cityStress.unityPressure, civicChoice.preview.pressureFloor.unityPressure);

  assert.equal(shadowApplied.cityStress.stage, shadowChoice.preview.pressureFloor.stage);
  assert.equal(shadowApplied.cityStress.total, shadowChoice.preview.pressureFloor.total);
  assert.equal(shadowApplied.cityStress.threatPressure, shadowChoice.preview.pressureFloor.threatPressure);
  assert.equal(shadowApplied.cityStress.unityPressure, shadowChoice.preview.pressureFloor.unityPressure);
});



test("settlement lane profiles expose response focus that matches lane ordering truth", () => {
  const civic = buildSettlementLaneChoice("city");
  const shadow = buildSettlementLaneChoice("black_market");

  assert.deepEqual(civic.responseFocus.preferredActionLanes, getSettlementLanePreferredActionOrder("city"));
  assert.deepEqual(shadow.responseFocus.preferredActionLanes, getSettlementLanePreferredActionOrder("black_market"));
  assert.match(civic.responseFocus.advisoryTone, /civic/i);
  assert.match(shadow.responseFocus.advisoryTone, /shadow/i);
  assert.notEqual(civic.responseFocus.recommendedOpening, shadow.responseFocus.recommendedOpening);
});


test("city summary exposes the latest lane receipt from the event trail", () => {
  const civic = createInitialPlayerState("lane-latest-civic", seedWorld(), defaultPolicies);
  const shadow = createInitialPlayerState("lane-latest-shadow", seedWorld(), defaultPolicies);
  applySettlementLaneBootstrap(civic, "city");
  applySettlementLaneBootstrap(shadow, "black_market");

  const civicAdvanceTo = new Date(new Date(civic.lastTickAt).getTime() + 5 * 60_000);
  const shadowAdvanceTo = new Date(new Date(shadow.lastTickAt).getTime() + 5 * 60_000);
  tickPlayerState(civic, civicAdvanceTo);
  tickPlayerState(shadow, shadowAdvanceTo);

  const civicSummary = buildCitySummary(civic);
  const shadowSummary = buildCitySummary(shadow);

  assert.match(civicSummary.settlementLaneLatestReceipt.title, /latest civic receipt/i);
  assert.match(civicSummary.settlementLaneLatestReceipt.message, /Civic surplus kept the city steady/i);
  assert.equal(civicSummary.settlementLaneLatestReceipt.kind, "city_morph");

  assert.match(shadowSummary.settlementLaneLatestReceipt.title, /latest shadow receipt/i);
  assert.match(shadowSummary.settlementLaneLatestReceipt.message, /Shadow surplus skimmed extra returns/i);
  assert.equal(shadowSummary.settlementLaneLatestReceipt.kind, "city_morph");

  assert.equal(civicSummary.settlementLaneLatestReceipt.message, buildSettlementLaneLatestReceipt(civic).message);
  assert.equal(shadowSummary.settlementLaneLatestReceipt.message, buildSettlementLaneLatestReceipt(shadow).message);
});
