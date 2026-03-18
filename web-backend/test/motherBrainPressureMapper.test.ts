//web-backend/test/motherBrainPressureMapper.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  getOrCreatePlayerState,
  syncMotherBrainPressureMap,
  tickPlayerState,
} from "../gameState";

test("mother brain pressure mapper flags exposure windows and likely threat families", () => {
  const ps = getOrCreatePlayerState("mb_pressure_window_player");
  const now = new Date("2026-03-18T23:00:00Z");

  ps.city.stats.prosperity = 76;
  ps.city.stats.security = 34;
  ps.city.stats.infrastructure = 68;
  ps.city.stats.influence = 61;
  ps.city.stats.arcaneSaturation = 73;
  ps.city.stats.stability = 49;
  ps.city.stats.unity = 51;
  ps.cityStress.threatPressure = 66;
  ps.cityStress.total = 61;
  const homeWar = ps.regionWar.find((entry) => entry.regionId === ps.city.regionId);
  if (homeWar) homeWar.threat = 72;

  tickPlayerState(ps, now);

  const windows = ps.motherBrainPressureMap ?? [];
  assert.ok(windows.length > 0, "expected mother brain precursor to flag pressure windows");
  assert.ok(windows.every((window) => window.reasons.length > 0), "pressure windows should explain why the city is exposed");
  assert.ok(windows.every((window) => window.responseTags.length > 0), "pressure windows should nominate likely response lanes");
  assert.ok(windows.some((window) => window.threatFamily === "bandits" || window.threatFamily === "early_planar_strike"), "expected mapper to nominate at least one likely hostile family");
  assert.ok(new Date(windows[0]!.latestWindowAt).getTime() > new Date(windows[0]!.earliestWindowAt).getTime(), "pressure windows should expose a readable impact window");
});

test("mother brain pressure mapper stays read-only and does not mutate conquest state", () => {
  const ps = getOrCreatePlayerState("mb_pressure_readonly_player");
  const now = new Date("2026-03-18T23:20:00Z");

  ps.currentOffers = [
    {
      id: "mb_offer_test",
      kind: "army",
      difficulty: "high",
      title: "Pressure test",
      description: "Used to test mother brain pressure previews.",
      regionId: ps.city.regionId,
      recommendedPower: 140,
      expectedRewards: { materials: 30 },
      risk: { casualtyRisk: "high" },
      responseTags: ["frontline", "command"],
      threatFamily: "organized_hostile_forces",
      targetingPressure: 82,
      targetingReasons: ["Regional threat is elevated and the city is visibly exposed."],
    },
  ] as any;
  ps.threatWarnings = [
    {
      id: "warn_mb_offer_test",
      missionId: "mb_offer_test",
      targetRegionId: ps.city.regionId,
      issuedAt: now.toISOString(),
      earliestImpactAt: new Date(now.getTime() + 20 * 60_000).toISOString(),
      latestImpactAt: new Date(now.getTime() + 55 * 60_000).toISOString(),
      severity: 67,
      intelQuality: "clear",
      headline: "Confirmed warning",
      detail: "Test warning detail.",
      responseTags: ["frontline", "command"],
      recommendedAction: "Hold the gate.",
      threatFamily: "organized_hostile_forces",
      targetingPressure: 82,
      targetingReasons: ["Regional threat is elevated and the city is visibly exposed."],
    },
  ] as any;

  const regionWarBefore = JSON.stringify(ps.regionWar);
  const resourcesBefore = JSON.stringify(ps.resources);
  const offersBefore = JSON.stringify(ps.currentOffers);

  const result = syncMotherBrainPressureMap(ps, now);

  assert.ok(result.pressureMap.length > 0, "expected a read-only pressure preview");
  assert.equal(JSON.stringify(ps.regionWar), regionWarBefore, "pressure mapping should not mutate conquest state");
  assert.equal(JSON.stringify(ps.resources), resourcesBefore, "pressure mapping should not spend city resources");
  assert.equal(JSON.stringify(ps.currentOffers), offersBefore, "pressure mapping should not rewrite mission offers");
});
