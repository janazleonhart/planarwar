//web-backend/test/blackMarketLaneTruth.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import { getOrCreatePlayerState } from "../gameState";
import { deriveEconomyCartelResponseState } from "../domain/economyCartelResponse";
import { pushWorldConsequence } from "../domain/worldConsequences";

test("black market unlock truth follows settlement lane instead of legacy tech flags", () => {
  const civic = getOrCreatePlayerState("black_market_lane_truth_civic");
  civic.city.settlementLane = "city";
  civic.techFlags = ["BLACK_MARKET_ENABLED"];
  pushWorldConsequence(civic, {
    regionId: civic.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Port authority collapse",
    summary: "Heat and scarcity opened a live black-market window with real downside.",
    detail: "Civic settlements should read this as pressure, not permission.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["city_pressure_export", "trade_disruption", "black_market_opening", "world_economy_hook", "faction_drift"],
    metrics: { pressureDelta: 17, recoveryDelta: 9, controlDelta: -5, threatDelta: 8 },
    outcome: "failure",
  });

  const civicResponse = deriveEconomyCartelResponseState(civic);
  assert.equal(civicResponse.blackMarket.unlocked, false);
  assert.match(civicResponse.blackMarket.note, /civic lane/i);

  const shadow = getOrCreatePlayerState("black_market_lane_truth_shadow");
  shadow.city.settlementLane = "black_market";
  pushWorldConsequence(shadow, {
    regionId: shadow.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Port authority collapse",
    summary: "Heat and scarcity opened a live black-market window with real downside.",
    detail: "Shadow settlements should be allowed to exploit this directly.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["city_pressure_export", "trade_disruption", "black_market_opening", "world_economy_hook", "faction_drift"],
    metrics: { pressureDelta: 17, recoveryDelta: 9, controlDelta: -5, threatDelta: 8 },
    outcome: "failure",
  });

  const shadowResponse = deriveEconomyCartelResponseState(shadow);
  assert.equal(shadowResponse.blackMarket.unlocked, true);
  assert.ok(["active", "surging"].includes(shadowResponse.blackMarket.state));
});
