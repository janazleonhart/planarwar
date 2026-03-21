//web-backend/test/missionOutcomeFollowups.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  completeMissionForPlayer,
  getOrCreatePlayerState,
  startMissionForPlayer,
} from "../gameState";

function withRandomSequence<T>(values: number[], fn: () => T): T {
  const original = Math.random;
  let index = 0;
  Math.random = () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0.5;
    index += 1;
    return value;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test("successful hero missions open a concrete follow-up army opportunity", () => {
  const ps = getOrCreatePlayerState("mission_followup_success_player");
  const now = new Date("2026-03-21T21:00:00Z");

  ps.resources.wealth = 800;
  ps.resources.materials = 700;
  ps.resources.food = 400;
  ps.resources.unity = 180;
  ps.city.stats.security = 66;
  ps.city.stats.infrastructure = 61;
  ps.city.stats.unity = 64;
  ps.regionWar[0]!.threat = 48;
  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.heroes = [
    {
      id: "hero_followup_success",
      ownerId: ps.playerId,
      name: "Lysa Vann",
      role: "scout",
      responseRoles: ["recon", "command"],
      traits: [],
      power: 92,
      tags: [],
      status: "idle",
      attachments: [],
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "mission_followup_success_seed",
      kind: "hero",
      difficulty: "medium",
      title: "Scout the Broken Route",
      description: "Find the smugglers' relay before it shifts again.",
      regionId: ps.city.regionId,
      recommendedPower: 72,
      expectedRewards: { knowledge: 18, wealth: 14 },
      risk: { casualtyRisk: "moderate", heroInjuryRisk: "low" },
      responseTags: ["recon", "command"],
      threatFamily: "mercs",
    },
  ] as any;

  const active = startMissionForPlayer(ps.playerId, "mission_followup_success_seed", now, "hero_followup_success", undefined, "balanced");
  assert.ok(active, "expected mission to start");
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.12, 0.09], () => completeMissionForPlayer(ps.playerId, active!.instanceId, now));
  assert.equal(result.status, "ok");
  assert.equal(result.outcome?.kind, "success");
  assert.ok(result.followupOffers?.length, "expected follow-up offers to be returned");

  const followup = result.followupOffers?.[0];
  assert.ok(followup, "expected a follow-up offer");
  assert.equal(followup.kind, "army");
  assert.equal(followup.followupSourceMissionId, "mission_followup_success_seed");
  assert.equal(followup.followupGeneratedByOutcome, "success");
  assert.match(followup.title, /Exploit the Opening/i);
  assert.ok((ps.currentOffers ?? []).some((offer) => offer.id === followup.id), "follow-up should be present on the live mission board");
});

test("failed army missions open a concrete containment follow-up instead of stopping at the receipt", () => {
  const ps = getOrCreatePlayerState("mission_followup_failure_player");
  const now = new Date("2026-03-21T21:30:00Z");

  ps.resources.wealth = 900;
  ps.resources.materials = 900;
  ps.resources.food = 500;
  ps.resources.unity = 160;
  ps.city.stats.security = 52;
  ps.city.stats.infrastructure = 48;
  ps.city.stats.unity = 51;
  ps.cityStress.threatPressure = 36;
  ps.cityStress.recoveryBurden = 22;
  ps.regionWar[0]!.threat = 63;
  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.armies = [
    {
      id: "army_followup_failure",
      cityId: ps.city.id,
      name: "Southgate Irregulars",
      type: "militia",
      power: 86,
      size: 240,
      readiness: 34,
      upkeep: { wealth: 8, materials: 5 },
      specialties: ["defense", "frontline"],
      status: "idle",
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "mission_followup_failure_seed",
      kind: "army",
      difficulty: "high",
      title: "Hold the Ravine Gate",
      description: "A hostile column is trying to force the crossing.",
      regionId: ps.city.regionId,
      recommendedPower: 170,
      expectedRewards: { materials: 28, wealth: 16 },
      risk: { casualtyRisk: "severe" },
      responseTags: ["frontline", "defense"],
      threatFamily: "organized_hostile_forces",
    },
  ] as any;

  const active = startMissionForPlayer(ps.playerId, "mission_followup_failure_seed", now, undefined, "army_followup_failure", "cautious");
  assert.ok(active, "expected mission to start");
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.94, 0.71], () => completeMissionForPlayer(ps.playerId, active!.instanceId, now));
  assert.equal(result.status, "ok");
  assert.equal(result.outcome?.kind, "failure");
  assert.ok(result.followupOffers?.length, "expected follow-up offers to be returned");

  const followup = result.followupOffers?.[0];
  assert.ok(followup, "expected a containment follow-up offer");
  assert.equal(followup.kind, "hero");
  assert.equal(followup.followupSourceMissionId, "mission_followup_failure_seed");
  assert.equal(followup.followupGeneratedByOutcome, "failure");
  assert.match(followup.title, /Contain the Fallout/i);
  assert.ok(followup.recommendedPower >= 150, "containment follow-up should remain serious after a failed frontline action");
  assert.ok((ps.currentOffers ?? []).some((offer) => offer.id === followup.id), "containment follow-up should be present on the live mission board");
});
