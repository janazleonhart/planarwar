//web-backend/test/economyCartelResponseCloseout.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";
import { summarizeCityMudBridge, deriveCityMudConsumers, deriveVendorSupportPolicy, deriveVendorRuntimeEffect, deriveVendorPresetRecommendation } from "../domain/cityMudBridge";
import { applyWorldConsequenceMissionGuidance, applyWorldConsequenceVendorPolicy, deriveWorldConsequenceConsumers } from "../domain/worldConsequenceConsumers";
import { pushWorldConsequence } from "../domain/worldConsequences";

test("economy/cartel closeout keeps vendor and mission runtime on the same response story", () => {
  const ps = getOrCreatePlayerState(`economy_cartel_closeout_${Date.now()}`);
  ps.city.settlementLane = "black_market";
  ps.resources.food = 180;
  ps.resources.materials = 165;
  ps.resources.wealth = 140;
  ps.resources.mana = 72;
  ps.city.stats.infrastructure = 48;
  ps.city.stats.prosperity = 42;
  ps.city.stats.security = 39;
  ps.cityStress.total = 57;
  ps.cityStress.stage = "strained";

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Smuggling corridor rupture",
    summary: "Black market demand and cartel interest are both climbing into open pressure.",
    detail: "Closeout contract: vendor and mission runtime must tell the same response story as the shared response state.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["trade_disruption", "black_market_opening", "world_economy_hook", "faction_drift"],
    metrics: { pressureDelta: 20, recoveryDelta: 8, controlDelta: -6, threatDelta: 10 },
    outcome: "failure",
  });

  const response = deriveEconomyCartelResponseState(ps);
  const bridge = summarizeCityMudBridge(ps);
  const bridgeConsumers = deriveCityMudConsumers(bridge);
  const consequenceConsumers = deriveWorldConsequenceConsumers(ps);
  const baseVendorPolicy = deriveVendorSupportPolicy(bridge, bridgeConsumers);
  const effectiveVendorPolicy = applyWorldConsequenceVendorPolicy(baseVendorPolicy, consequenceConsumers);
  const runtime = deriveVendorRuntimeEffect({
    stock: 6,
    stockMax: 24,
    restockEverySec: 1800,
    restockAmount: 4,
    priceMinMult: 0.95,
    priceMaxMult: 1.35,
  }, effectiveVendorPolicy);
  const missionGuidance = applyWorldConsequenceMissionGuidance({
    state: bridgeConsumers.missionBoard.state === "abundant" ? "stable" : bridgeConsumers.missionBoard.state === "stable" ? "stable" : bridgeConsumers.missionBoard.state,
    severity: bridgeConsumers.missionBoard.severity,
    headline: bridgeConsumers.missionBoard.headline,
    detail: bridgeConsumers.missionBoard.detail,
    recommendedAction: bridgeConsumers.missionBoard.recommendedAction,
  }, consequenceConsumers);
  const preset = deriveVendorPresetRecommendation({
    policyState: effectiveVendorPolicy.state,
    responsePhase: response.summary.responsePhase,
    laneBias: response.vendors.laneBias,
  });

  assert.equal(consequenceConsumers.summary.pressureTier, response.summary.responsePhase);
  assert.equal(consequenceConsumers.summary.shouldNudgeRuntime, response.summary.shouldNudgeRuntime);
  assert.ok(["active", "severe"].includes(response.summary.responsePhase));
  assert.ok(["pressured", "restricted"].includes(effectiveVendorPolicy.state));
  assert.ok(["tight", "scarce"].includes(runtime.state));
  assert.ok(["pressured", "restricted"].includes(missionGuidance.state));
  assert.ok((missionGuidance.severity ?? 0) >= bridgeConsumers.missionBoard.severity);
  assert.ok(preset);
  assert.match(preset!.reason, /response|vendor|lane/i);
});
