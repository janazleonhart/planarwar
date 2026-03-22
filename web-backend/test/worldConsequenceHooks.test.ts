//web-backend/test/worldConsequenceHooks.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { deriveWorldConsequenceHooks, getOrCreatePlayerState } from "../gameState";
import { pushWorldConsequence } from "../domain/worldConsequences";

test("black market hooks stay locked without unlock flag but expose an opening when pressure rises", () => {
  const ps = getOrCreatePlayerState("world_consequence_hooks_locked_player");
  ps.techFlags = [];

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Caravan route cracked open",
    summary: "Regional panic and scarcity are opening illicit lanes.",
    detail: "This setback should expose a black-market opening even for cities that have not unlocked that lane yet.",
    audiences: ["player", "mother_brain", "admin"],
    tags: ["city_pressure_export", "regional_instability", "trade_disruption", "black_market_opening", "world_economy_hook"],
    metrics: {
      pressureDelta: 14,
      recoveryDelta: 10,
      controlDelta: -4,
      threatDelta: 6,
    },
    outcome: "failure",
  });

  const hooks = deriveWorldConsequenceHooks(ps);
  assert.equal(hooks.blackMarket.unlocked, false);
  assert.equal(hooks.blackMarket.status, "opening");
  assert.equal(hooks.blackMarket.recommendedPosture, "watch");
  assert.ok(hooks.summary.topRegionIds.includes(String(ps.city.regionId)));
  assert.match(hooks.summary.headline, /hook|window|black-market/i);
});

test("black market and cartel hooks become active once the city can actually exploit the seam", () => {
  const ps = getOrCreatePlayerState("world_consequence_hooks_active_player");
  ps.city.settlementLane = "black_market";

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "mission_setback",
    severity: "severe",
    title: "Escort network collapse",
    summary: "A brutal escort failure destabilized regional routes.",
    detail: "High pressure and threat should light up black-market and cartel hook consumers.",
    audiences: ["player", "mother_brain", "admin"],
    tags: ["city_pressure_export", "regional_instability", "trade_disruption", "black_market_opening", "world_economy_hook", "faction_drift"],
    metrics: {
      pressureDelta: 16,
      recoveryDelta: 9,
      controlDelta: -5,
      threatDelta: 8,
    },
    outcome: "failure",
  });

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "recovery_contract",
    severity: "pressure",
    title: "Recovery corruption leak",
    summary: "A crooked recovery chain widened shortages instead of closing them.",
    detail: "A second consequence keeps the hooks active instead of fading back to theory-land.",
    audiences: ["player", "mother_brain", "admin"],
    tags: ["city_pressure_export", "recovery_load", "black_market_opening", "world_economy_hook"],
    metrics: {
      pressureDelta: 7,
      recoveryDelta: 6,
      controlDelta: -1,
      threatDelta: 3,
    },
    outcome: "partial",
  });

  const hooks = deriveWorldConsequenceHooks(ps);
  assert.equal(hooks.blackMarket.unlocked, true);
  assert.ok(["active", "surging"].includes(hooks.blackMarket.status));
  assert.ok(hooks.blackMarket.opportunityScore > 0);
  assert.ok(["probe", "exploit", "contain"].includes(hooks.blackMarket.recommendedPosture));
  assert.ok(["active", "severe"].includes(hooks.cartel.pressureTier));
  assert.notEqual(hooks.worldEconomy.riskTier, "low");
  assert.notEqual(hooks.faction.responseBias, "quiet");
  assert.equal(hooks.summary.hasActiveHooks, true);
});


test("world consequence hooks can cool back to quiet after stabilization exports despite ledger history", () => {
  const ps = getOrCreatePlayerState("world_consequence_hooks_cooling_player");
  ps.city.settlementLane = "black_market";

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "bridge_snapshot",
    severity: "pressure",
    title: "Recovery pressure exported: stabilization",
    summary: "Recovery strain is exporting regional pressure and recovery load.",
    detail: "Initial exported strain should wake hook consumers.",
    audiences: ["player", "mother_brain", "admin"],
    tags: ["city_pressure_export", "regional_instability", "recovery_load", "world_economy_hook", "trade_disruption", "black_market_opening"],
    metrics: { pressureDelta: 5, recoveryDelta: 4, controlDelta: 0, threatDelta: 2 },
    contractKind: "stabilize_district",
  });

  const hot = deriveWorldConsequenceHooks(ps);
  assert.equal(hot.summary.hasActiveHooks, true);
  assert.ok(hot.summary.topRegionIds.includes(String(ps.city.regionId)));

  pushWorldConsequence(ps, {
    regionId: ps.city.regionId,
    source: "bridge_snapshot",
    severity: "watch",
    title: "Recovery pressure exported: stabilization",
    summary: "City stabilization has cooled exported regional pressure and recovery load after recovery pressure subsided.",
    detail: "Cooling propagation should let hook consumers relax instead of staying stuck on ledger history.",
    audiences: ["player", "mother_brain", "admin"],
    tags: ["city_pressure_export", "regional_instability", "recovery_load", "world_economy_hook", "trade_disruption", "black_market_opening"],
    metrics: { pressureDelta: -5, recoveryDelta: -4, controlDelta: 0, threatDelta: -2 },
    contractKind: "stabilize_district",
  });

  const cooled = deriveWorldConsequenceHooks(ps);
  assert.equal(cooled.summary.hasActiveHooks, false);
  assert.equal(cooled.summary.topRegionIds.length, 0);
  assert.equal(cooled.blackMarket.status, "latent");
  assert.equal(cooled.cartel.pressureTier, "low");
  assert.equal(cooled.worldEconomy.riskTier, "low");
  assert.equal(cooled.faction.responseBias, "quiet");
  assert.match(cooled.summary.headline, /cooled|quiet again/i);

  
  
});
