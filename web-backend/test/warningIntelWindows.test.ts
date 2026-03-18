//web-backend/test/warningIntelWindows.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  getOrCreatePlayerState,
  regenerateRegionMissionsForPlayer,
  tickPlayerState,
} from "../gameState";

test("threat warnings generate readable lead-time windows", () => {
  const ps = getOrCreatePlayerState("warning_window_player");
  const now = new Date("2026-03-18T12:00:00Z");

  const targetRegionId = ps.regionWar[0]!.regionId;
  ps.city.regionId = targetRegionId as any;
  const homeWar = ps.regionWar.find((entry) => entry.regionId === targetRegionId);
  assert.ok(homeWar);
  homeWar!.threat = 82;

  ps.city.stats.security = 58;
  ps.city.stats.infrastructure = 52;

  regenerateRegionMissionsForPlayer(ps.playerId, targetRegionId as any, now);
  tickPlayerState(ps, now);

  assert.ok((ps.threatWarnings ?? []).length > 0, "expected at least one warning window");
  const first = ps.threatWarnings[0]!;

  assert.equal(typeof first.headline, "string");
  assert.equal(typeof first.detail, "string");
  assert.ok(first.responseTags.length > 0, "warning should include response lanes");
  assert.ok(first.recommendedAction.includes("response"), "warning should be actionable");
  assert.ok(new Date(first.earliestImpactAt).getTime() > new Date(first.issuedAt).getTime(), "warning should have lead time");
  assert.ok(new Date(first.latestImpactAt).getTime() > new Date(first.earliestImpactAt).getTime(), "warning window should be readable");
});

test("warning quality improves with recon assets and planning tech", () => {
  const lowIntel = getOrCreatePlayerState("warning_quality_low");
  const highIntel = getOrCreatePlayerState("warning_quality_high");
  const now = new Date("2026-03-18T13:00:00Z");

  for (const ps of [lowIntel, highIntel]) {
    const targetRegionId = ps.regionWar[0]!.regionId;
    ps.city.regionId = targetRegionId as any;
    const homeWar = ps.regionWar.find((entry) => entry.regionId === targetRegionId);
    assert.ok(homeWar);
    homeWar!.threat = 78;
    regenerateRegionMissionsForPlayer(ps.playerId, targetRegionId as any, now);
  }

  lowIntel.city.stats.security = 18;
  lowIntel.city.stats.infrastructure = 14;
  lowIntel.heroes = [];
  lowIntel.armies = [];
  lowIntel.researchedTechIds = [];
  tickPlayerState(lowIntel, now);

  highIntel.city.stats.security = 74;
  highIntel.city.stats.infrastructure = 68;
  highIntel.researchedTechIds = ["militia_training_1", "urban_planning_1"];
  tickPlayerState(highIntel, now);

  assert.ok(lowIntel.threatWarnings.length > 0, "expected low-intel warnings");
  assert.ok(highIntel.threatWarnings.length > 0, "expected high-intel warnings");

  const low = lowIntel.threatWarnings[0]!;
  const high = highIntel.threatWarnings[0]!;
  const order = { faint: 0, usable: 1, clear: 2, precise: 3 } as const;

  assert.ok(order[high.intelQuality] > order[low.intelQuality], "expected warning quality to improve with recon/intel assets");
  const lowLead = new Date(low.earliestImpactAt).getTime() - new Date(low.issuedAt).getTime();
  const highLead = new Date(high.earliestImpactAt).getTime() - new Date(high.issuedAt).getTime();
  assert.ok(highLead > lowLead, "better intel should give more lead time");
});
