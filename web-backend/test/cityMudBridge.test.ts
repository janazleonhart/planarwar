//web-backend/test/cityMudBridge.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { summarizeCityMudBridge } from "../domain/cityMudBridge";
import { createInitialPublicInfrastructureState } from "../domain/publicInfrastructure";
import { getOrCreatePlayerState } from "../gameState";

function makePlayer() {
  const ps = getOrCreatePlayerState(`citymud_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  ps.publicInfrastructure = createInitialPublicInfrastructureState("2026-03-16T00:00:00.000Z");
  return ps;
}

test("city-mud bridge summary exposes surplus-driven vendor supply when city is healthy", () => {
  const ps = makePlayer();
  ps.resources.food = 260;
  ps.resources.materials = 240;
  ps.resources.wealth = 220;
  ps.resources.mana = 100;
  ps.resources.knowledge = 80;
  ps.resources.unity = 70;
  ps.city.stats.infrastructure = 72;
  ps.city.stats.prosperity = 68;
  ps.city.stats.security = 62;
  ps.cityStress.total = 12;
  ps.cityStress.stage = "stable";

  const summary = summarizeCityMudBridge(ps);
  const vendorSupply = summary.hooks.find((hook) => hook.key === "vendor_supply");

  assert.ok(vendorSupply);
  assert.equal(summary.bridgeBand, "open");
  assert.equal(summary.recommendedPosture, "supportive");
  assert.ok(summary.supportCapacity >= 60);
  assert.ok((summary.exportableResources.materials ?? 0) > 0);
  assert.equal(vendorSupply?.direction, "up");
});

test("city-mud bridge summary becomes defensive under frontier and civic pressure", () => {
  const ps = makePlayer();
  ps.cityStress.total = 84;
  ps.cityStress.stage = "lockdown";
  ps.regionWar[0].threat = 90;
  ps.regionWar[1].threat = 66;
  ps.publicInfrastructure.serviceHeat = 78;
  ps.activeMissions.push({
    instanceId: "mission_bridge_a",
    startedAt: "2026-03-16T00:00:00.000Z",
    finishesAt: "2026-03-16T03:00:00.000Z",
    mission: {
      id: "mission_bridge_a",
      kind: "army",
      difficulty: "high",
      title: "Hold the ridge",
      description: "Test mission",
      regionId: "ancient_elwynn",
      recommendedPower: 120,
      expectedRewards: { materials: 20 },
      risk: { casualtyRisk: "Severe" },
    },
  });
  if (ps.armies[0]) ps.armies[0].status = "on_mission";

  const summary = summarizeCityMudBridge(ps);
  const caravanRisk = summary.hooks.find((hook) => hook.key === "caravan_risk");
  const publicDrag = summary.hooks.find((hook) => hook.key === "public_service_drag");

  assert.equal(summary.bridgeBand, "restricted");
  assert.equal(summary.recommendedPosture, "defensive");
  assert.ok(summary.frontierPressure >= 60);
  assert.ok(summary.stabilityPressure >= 65);
  assert.ok(caravanRisk && caravanRisk.score >= 60);
  assert.ok(publicDrag && publicDrag.score > 0);
  assert.match(summary.note, /under real pressure/i);
});
