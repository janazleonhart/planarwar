//web-backend/test/worldConsequenceActions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";
import { pushWorldConsequence } from "../domain/worldConsequences";

test("quiet world consequence state still returns an observe-only recommendation", () => {
  const ps = getOrCreatePlayerState("world_consequence_actions_quiet_player");
  ps.worldConsequences = [];
  ps.worldConsequenceState = {
    regions: [],
    worldEconomy: { tradePressure: 0, supplyFriction: 0, cartelAttention: 0, destabilization: 0, outlook: "stable" },
    blackMarket: { opportunityScore: 0, heat: 0, outlook: "quiet" },
    factionPressure: { driftScore: 0, instability: 0, dominantStance: "stable" },
    summary: { affectedRegionIds: [], totalLedgerEntries: 0, severeCount: 0, destabilizationScore: 0, note: "No propagated consequence pressure yet." },
  };

  const actions = deriveWorldConsequenceActions(ps);
  assert.equal(actions.playerActions[0]?.id, "action_observe_until_pressure_is_real");
  assert.equal(actions.adminActions.length, 0);
});

test("active world consequence pressure yields player and admin recommendations", () => {
  const ps = getOrCreatePlayerState("world_consequence_actions_hot_player");
  ps.techFlags = ["BLACK_MARKET_ENABLED"];

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Trade corridor collapse",
    summary: "Route pressure, faction drift, and illicit demand all spiked together.",
    detail: "This should produce actionable economy, cartel, faction, and black-market recommendations.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["city_pressure_export", "trade_disruption", "black_market_opening", "faction_drift", "world_economy_hook"],
    metrics: {
      pressureDelta: 18,
      recoveryDelta: 10,
      controlDelta: -6,
      threatDelta: 7,
    },
    outcome: "failure",
  });

  const actions = deriveWorldConsequenceActions(ps);
  assert.ok(actions.playerActions.some((action) => action.lane === "economy"));
  assert.ok(actions.playerActions.some((action) => action.lane === "black_market"));
  assert.ok(actions.adminActions.some((action) => action.lane === "observability" || action.lane === "economy"));
  assert.ok(actions.recommendedPrimaryAction.length > 0);
});


test("regional action evidence follows the hottest hotspot instead of page-level guesses", () => {
  const ps = getOrCreatePlayerState("world_consequence_actions_regional_evidence_player");
  ps.techFlags = ["BLACK_MARKET_ENABLED"];

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Market district flare-up",
    summary: "Regional trade disruption and faction drift both spiked.",
    detail: "This should produce a hotspot-backed regional action with concrete evidence.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["city_pressure_export", "trade_disruption", "black_market_opening", "faction_drift"],
    metrics: {
      pressureDelta: 16,
      recoveryDelta: 9,
      controlDelta: -4,
      threatDelta: 5,
    },
    outcome: "failure",
  });

  const actions = deriveWorldConsequenceActions(ps);
  const regional = actions.playerActions.find((action) => action.id.startsWith("action_region_"));
  assert.ok(regional);
  assert.deepEqual(
    regional?.evidence?.map((entry) => entry.label),
    ["regional trade disruption", "regional black-market heat", "regional faction drift"],
  );
  assert.ok((regional?.evidence?.[0]?.value ?? 0) > 0);
  assert.ok(["watch", "high", "critical"].includes(regional?.evidence?.[0]?.tone ?? ""));
});


test("active black-market hooks expose both exploit and contain player choices", () => {
  const ps = getOrCreatePlayerState("world_consequence_actions_black_market_choices_player");
  ps.techFlags = ["BLACK_MARKET_ENABLED"];

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Port authority collapse",
    summary: "Heat and scarcity opened a live black-market window with real downside.",
    detail: "Players should see both the greedy option and the containment option instead of one hidden by posture math.",
    audiences: ["player", "admin", "mother_brain"],
    tags: ["city_pressure_export", "trade_disruption", "black_market_opening", "world_economy_hook", "faction_drift"],
    metrics: {
      pressureDelta: 17,
      recoveryDelta: 9,
      controlDelta: -5,
      threatDelta: 8,
    },
    outcome: "failure",
  });

  const actions = deriveWorldConsequenceActions(ps);
  const blackMarketIds = actions.playerActions
    .filter((action) => action.lane === "black_market")
    .map((action) => action.id);

  assert.ok(blackMarketIds.includes("action_black_market_window_exploit"));
  assert.ok(blackMarketIds.includes("action_black_market_window_contain"));
});
