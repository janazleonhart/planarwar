//web-backend/test/worldConsequenceActions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState } from "../gameState";
import { deriveWorldConsequenceActions } from "../domain/worldConsequenceActions";
import { pushWorldConsequence } from "../domain/worldConsequences";
import type { WorldConsequenceAudience, WorldConsequenceTag } from "../domain/worldConsequences";

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
  ps.city.settlementLane = "black_market";

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
  ps.city.settlementLane = "black_market";

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
  ps.city.settlementLane = "black_market";

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
  assert.ok(blackMarketIds.includes("action_black_market_window_bribe"));
});


test("identical pressure yields lane-specific economy and cartel advisories", () => {
  const civic = getOrCreatePlayerState("world_consequence_actions_lane_specific_civic_player");
  civic.city.settlementLane = "city";

  const shadow = getOrCreatePlayerState("world_consequence_actions_lane_specific_shadow_player");
  shadow.city.settlementLane = "black_market";

  const consequence = {
    regionId: civic.city.regionId,
    source: "mission_setback" as const,
    severity: "severe" as const,
    title: "Supply crackdown",
    summary: "The same scarcity-and-cartel pressure should read differently by settlement lane.",
    detail: "City should receive civic stabilization advice; black market should receive shadow heat-management advice.",
    audiences: ["player", "admin", "mother_brain"] as WorldConsequenceAudience[],
    tags: [
      "city_pressure_export",
      "trade_disruption",
      "black_market_opening",
      "world_economy_hook",
      "faction_drift",
    ] as WorldConsequenceTag[],
    metrics: {
      pressureDelta: 19,
      recoveryDelta: 11,
      controlDelta: -6,
      threatDelta: 9,
    },
    outcome: "failure" as const,
  };

  pushWorldConsequence(civic, consequence);
  pushWorldConsequence(shadow, {
    ...consequence,
    regionId: shadow.city.regionId,
    audiences: [...consequence.audiences],
    tags: [...consequence.tags],
  });

  const civicActions = deriveWorldConsequenceActions(civic);
  const shadowActions = deriveWorldConsequenceActions(shadow);

  const civicEconomy = civicActions.playerActions.find((action) => action.lane === "economy");
  const shadowEconomy = shadowActions.playerActions.find((action) => action.lane === "economy");
  assert.ok(civicEconomy);
  assert.ok(shadowEconomy);
  assert.notEqual(civicEconomy?.title, shadowEconomy?.title);
  assert.notEqual(civicEconomy?.summary, shadowEconomy?.summary);

  const civicCartel = civicActions.playerActions.find((action) => action.lane === "cartel");
  const shadowCartel = shadowActions.playerActions.find((action) => action.lane === "cartel");
  assert.ok(civicCartel);
  assert.ok(shadowCartel);
  assert.notEqual(civicCartel?.title, shadowCartel?.title);
  assert.notEqual(civicCartel?.summary, shadowCartel?.summary);
});


test("identical pressure prefers different primary action lanes by settlement lane", () => {
  const civic = getOrCreatePlayerState("world_consequence_actions_lane_order_civic_player");
  civic.city.settlementLane = "city";

  const shadow = getOrCreatePlayerState("world_consequence_actions_lane_order_shadow_player");
  shadow.city.settlementLane = "black_market";

  const consequence = {
    regionId: civic.city.regionId,
    source: "mission_setback" as const,
    severity: "severe" as const,
    title: "Scarcity with shadow opportunity",
    summary: "The same pressure should bias civic settlements toward stabilization and shadow settlements toward underworld handling.",
    detail: "Primary action ordering should reflect lane identity instead of alphabetical accidents.",
    audiences: ["player", "admin", "mother_brain"] as WorldConsequenceAudience[],
    tags: [
      "city_pressure_export",
      "trade_disruption",
      "black_market_opening",
      "world_economy_hook",
      "faction_drift",
    ] as WorldConsequenceTag[],
    metrics: {
      pressureDelta: 20,
      recoveryDelta: 11,
      controlDelta: -6,
      threatDelta: 9,
    },
    outcome: "failure" as const,
  };

  pushWorldConsequence(civic, consequence);
  pushWorldConsequence(shadow, {
    ...consequence,
    regionId: shadow.city.regionId,
    audiences: [...consequence.audiences],
    tags: [...consequence.tags],
  });

  const civicActions = deriveWorldConsequenceActions(civic);
  const shadowActions = deriveWorldConsequenceActions(shadow);

  assert.equal(civicActions.playerActions[0]?.lane, "economy");
  assert.equal(shadowActions.playerActions[0]?.lane, "black_market");
  assert.notEqual(civicActions.recommendedPrimaryAction, shadowActions.recommendedPrimaryAction);
});
