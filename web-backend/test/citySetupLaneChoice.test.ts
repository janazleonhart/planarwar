//web-backend/test/citySetupLaneChoice.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { createInitialPlayerState } from "../gameState/gameStateCore";
import { defaultPolicies } from "../gameState";
import { seedWorld } from "../domain/world";
import { buildCityRuntimeSnapshot, applyCityRuntimeSnapshot } from "../gameState/cityRuntimeSnapshot";
import { applySettlementLaneBootstrap, normalizeSettlementLaneChoice } from "../routes/playerCityAccess";
import { buildSettlementLaneProfile } from "../routes/me";

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
  assert.equal(ps.eventLog.at(-1)?.kind, "city_stress_change");
});


test("settlement lane profile describes city and black-market starts distinctly", () => {
  const civic = buildSettlementLaneProfile("city");
  const shadow = buildSettlementLaneProfile("black_market");

  assert.equal(civic.id, "city");
  assert.equal(shadow.id, "black_market");
  assert.ok(civic.strengths.some((entry) => /standard civic baseline/i.test(entry)));
  assert.ok(shadow.strengths.some((entry) => /extra wealth, materials, and knowledge/i.test(entry)));
  assert.ok(shadow.liabilities.some((entry) => /strained early posture/i.test(entry)));
});
