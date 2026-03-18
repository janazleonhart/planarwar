//web-backend/test/threatFamiliesTargeting.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { generateMissionOffers } from "../domain/missions";
import { getOrCreatePlayerState, regenerateRegionMissionsForPlayer, tickPlayerState } from "../gameState";

test("mission generation tags offers with threat families and targeting reasons", () => {
  const ps = getOrCreatePlayerState("threat_family_bandits");
  ps.city.stats.prosperity = 78;
  ps.city.stats.security = 24;
  ps.city.stats.infrastructure = 58;
  ps.city.stats.influence = 44;
  ps.city.stats.arcaneSaturation = 18;
  ps.city.stats.stability = 66;
  ps.city.stats.unity = 62;

  const offers = generateMissionOffers({
    city: ps.city,
    heroes: ps.heroes,
    armies: ps.armies,
    regionId: ps.city.regionId,
    regionThreat: 52,
    cityThreatPressure: 48,
    cityStressTotal: 43,
  });

  assert.ok(offers.length >= 3, "expected a mission board");
  assert.ok(offers.some((offer) => offer.threatFamily === "bandits"), "expected bandit pressure to surface");
  for (const offer of offers) {
    assert.ok(offer.threatFamily, "expected offer to expose a threat family");
    assert.ok((offer.targetingPressure ?? 0) > 0, "expected positive targeting pressure");
    assert.ok((offer.targetingReasons?.length ?? 0) > 0, "expected readable targeting reasons");
  }
});

test("different city pressure profiles surface different hostile families in warnings", () => {
  const scenarios = [
    {
      playerId: "threat_family_mercs",
      setup: (ps: ReturnType<typeof getOrCreatePlayerState>) => {
        ps.city.stats.prosperity = 70;
        ps.city.stats.influence = 82;
        ps.city.stats.security = 52;
        ps.city.stats.arcaneSaturation = 20;
        ps.city.stats.stability = 62;
        ps.city.stats.unity = 60;
        ps.cityStress.threatPressure = 68;
        ps.cityStress.total = 59;
        ps.regionWar[0]!.threat = 44;
      },
      expected: "mercs",
    },
    {
      playerId: "threat_family_desperate",
      setup: (ps: ReturnType<typeof getOrCreatePlayerState>) => {
        ps.city.stats.prosperity = 66;
        ps.city.stats.influence = 28;
        ps.city.stats.security = 40;
        ps.city.stats.arcaneSaturation = 14;
        ps.city.stats.stability = 28;
        ps.city.stats.unity = 26;
        ps.cityStress.threatPressure = 72;
        ps.cityStress.total = 76;
        ps.regionWar[0]!.threat = 48;
      },
      expected: "desperate_towns",
    },
    {
      playerId: "threat_family_planar",
      setup: (ps: ReturnType<typeof getOrCreatePlayerState>) => {
        ps.city.stats.prosperity = 58;
        ps.city.stats.influence = 36;
        ps.city.stats.security = 48;
        ps.city.stats.arcaneSaturation = 88;
        ps.city.stats.stability = 54;
        ps.city.stats.unity = 52;
        ps.cityStress.threatPressure = 64;
        ps.cityStress.total = 61;
        ps.regionWar[0]!.threat = 62;
      },
      expected: "early_planar_strike",
    },
    {
      playerId: "threat_family_hostiles",
      setup: (ps: ReturnType<typeof getOrCreatePlayerState>) => {
        ps.city.stats.prosperity = 52;
        ps.city.stats.influence = 62;
        ps.city.stats.security = 38;
        ps.city.stats.arcaneSaturation = 30;
        ps.city.stats.stability = 50;
        ps.city.stats.unity = 48;
        ps.cityStress.threatPressure = 70;
        ps.cityStress.total = 68;
        ps.regionWar[0]!.threat = 90;
      },
      expected: "organized_hostile_forces",
    },
  ] as const;

  const now = new Date("2026-03-18T16:30:00Z");

  for (const scenario of scenarios) {
    const ps = getOrCreatePlayerState(scenario.playerId);
    scenario.setup(ps);
    const targetRegionId = ps.regionWar[0]!.regionId;
    ps.city.regionId = targetRegionId as any;
    regenerateRegionMissionsForPlayer(ps.playerId, targetRegionId as any, now);
    tickPlayerState(ps, now);

    assert.ok(ps.threatWarnings.length > 0, `expected warning windows for ${scenario.expected}`);
    assert.ok(
      ps.threatWarnings.some((warning) => warning.threatFamily === scenario.expected),
      `expected ${scenario.expected} pressure to appear in warnings`,
    );
  }
});
