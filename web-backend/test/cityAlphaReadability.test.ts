//web-backend/test/cityAlphaReadability.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { getOrCreatePlayerState, summarizeCityAlphaStatus, tickPlayerState } from "../gameState";

test("city alpha status summary consolidates warnings, readiness, receipts, and tester focus", () => {
  const ps = getOrCreatePlayerState("city_alpha_status_player");
  const now = new Date("2026-03-18T20:15:00Z");

  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.regionWar[0]!.threat = 83;
  ps.city.stats.security = 38;
  ps.city.stats.infrastructure = 57;
  ps.city.stats.prosperity = 62;
  ps.cityStress.threatPressure = 69;
  ps.cityStress.recoveryBurden = 46;
  ps.cityStress.total = 64;

  ps.heroes = [
    {
      id: "hero_watcher",
      ownerId: ps.playerId,
      name: "Iris Vale",
      role: "scout",
      responseRoles: ["recon", "recovery"],
      traits: [],
      power: 66,
      tags: [],
      status: "idle",
      attachments: [],
    },
  ] as any;

  ps.armies = [
    {
      id: "army_watch",
      cityId: ps.city.id,
      name: "Gate Wardens",
      type: "line",
      power: 104,
      size: 280,
      readiness: 81,
      upkeep: { wealth: 10, materials: 6 },
      specialties: ["defense", "frontline", "command"],
      status: "idle",
    },
  ] as any;

  tickPlayerState(ps, now);
  assert.ok(ps.threatWarnings.length > 0, "expected warning windows");
  assert.ok(ps.motherBrainPressureMap.length > 0, "expected pressure map windows");

  ps.missionReceipts = [
    {
      id: "receipt_recent",
      missionId: "warn_1",
      missionTitle: "Hold the breach",
      createdAt: now.toISOString(),
      outcome: "failure",
      posture: "desperate",
      threatFamily: "organized_hostile_forces",
      summary: "Recent defense recorded setbacks.",
      setbacks: [
        { kind: "infrastructure_damage", severity: 72, summary: "Outer wall damaged", detail: "Stonework collapsed around the gate." },
      ],
    },
  ];

  const status = summarizeCityAlphaStatus(ps);
  assert.equal(status.openWarningCount, ps.threatWarnings.length);
  assert.equal(status.recentReceiptCount, 1);
  assert.ok(status.readyArmyCount >= 1);
  assert.ok(status.idleHeroCount >= 1);
  assert.ok(status.readinessScore > 0);
  assert.ok(["watch", "pressed", "critical"].includes(status.severity));
  assert.ok(status.testerFocus.length > 0);
  assert.ok(status.topItems.length > 0);
  assert.ok(status.topItems.some((item) => item.kind === "warning" || item.kind === "pressure"));
});
