//web-backend/test/economyCartelResponseState.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import { pushWorldConsequence } from "../domain/worldConsequences";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";

test("economy/cartel response stays locked or watch-only when black market is not unlocked", () => {
  const ps = getOrCreatePlayerState("economy_cartel_response_locked_player");
  ps.techFlags = [];

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "pressure",
    title: "Loose contraband seams",
    summary: "Pressure is creating openings, but the city still lacks contacts.",
    detail: "This should not pretend the black market is runtime-active before unlock.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["trade_disruption", "black_market_opening", "world_economy_hook"],
    metrics: { pressureDelta: 8, recoveryDelta: 4, controlDelta: -2, threatDelta: 3 },
    outcome: "failure",
  });

  const state = deriveEconomyCartelResponseState(ps);
  assert.equal(state.blackMarket.unlocked, false);
  assert.equal(state.blackMarket.state, "opening");
  assert.equal(state.blackMarket.shouldNudgeRuntime, false);
  assert.ok(["watch", "active", "severe"].includes(state.summary.responsePhase));
});

test("economy/cartel response becomes runtime-active and escalates cartel tier under heavy pressure", () => {
  const ps = getOrCreatePlayerState("economy_cartel_response_hot_player");
  ps.city.settlementLane = "black_market";

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Route authority collapse",
    summary: "Illicit opportunity and cartel attention are both spiking.",
    detail: "This should cross from hook language into an explicit runtime response state.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["trade_disruption", "black_market_opening", "world_economy_hook", "faction_drift"],
    metrics: { pressureDelta: 18, recoveryDelta: 7, controlDelta: -5, threatDelta: 9 },
    outcome: "failure",
  });

  const state = deriveEconomyCartelResponseState(ps);
  assert.ok(["active", "surging"].includes(state.blackMarket.state));
  assert.ok(["active", "crackdown"].includes(state.cartel.tier));
  assert.equal(state.summary.shouldNudgeRuntime, true);
  assert.ok(state.vendors.stockMultiplierDelta < 0);
  assert.ok(state.missions.severityBoost > 0);
});


test("economy/cartel response can cool back to quiet after stabilization exports despite ledger history", () => {
  const ps = getOrCreatePlayerState("economy_cartel_response_cooling_player");
  ps.city.settlementLane = "black_market";

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "bridge_snapshot",
    severity: "pressure",
    title: "Recovery pressure exported: stabilization",
    summary: "Recovery strain is exporting regional pressure and recovery load.",
    detail: "Initial exported strain should wake the downstream response state.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["city_pressure_export", "regional_instability", "recovery_load", "world_economy_hook", "trade_disruption", "black_market_opening"],
    metrics: { pressureDelta: 5, recoveryDelta: 4, controlDelta: 0, threatDelta: 2 },
    contractKind: "stabilize_district",
  });

  const hot = deriveEconomyCartelResponseState(ps);
  assert.ok(["watch", "active", "severe"].includes(hot.summary.responsePhase));

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "bridge_snapshot",
    severity: "watch",
    title: "Recovery pressure exported: stabilization",
    summary: "City stabilization has cooled exported regional pressure and recovery load after recovery pressure subsided.",
    detail: "Cooling propagation should let downstream runtime response relax instead of staying stuck on historical ledger count.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["city_pressure_export", "world_economy_hook", "trade_disruption", "black_market_opening"],
    metrics: { pressureDelta: -5, recoveryDelta: -4, controlDelta: 0, threatDelta: -2 },
    contractKind: "stabilize_district",
  });

  const cooled = deriveEconomyCartelResponseState(ps);
  assert.equal(cooled.summary.responsePhase, "quiet");
  assert.equal(cooled.summary.shouldNudgeRuntime, false);
  assert.equal(cooled.blackMarket.state, "latent");
  assert.equal(cooled.cartel.tier, "none");
  assert.equal(cooled.vendors.state, "none");
  assert.equal(cooled.missions.state, "none");
});
