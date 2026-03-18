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
  ps.techFlags = ["BLACK_MARKET_ENABLED"];

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
