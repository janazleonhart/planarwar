//web-backend/test/missionOutcomeFollowups.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  completeMissionForPlayer,
  getOrCreatePlayerState,
  startMissionForPlayer,
} from "../gameState";

import {__testOnlyMissionOfferMerge} from "../gameState/gameStateMissions"

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


test("successful press-advantage follow-ups cash out extra payoff and cut pressure harder than the base result alone", () => {
  const ps = getOrCreatePlayerState("mission_followup_chain_success_player");
  const now = new Date("2026-03-21T22:00:00Z");

  ps.resources.wealth = 1000;
  ps.resources.materials = 1000;
  ps.resources.food = 600;
  ps.resources.unity = 180;
  ps.city.stats.security = 62;
  ps.city.stats.infrastructure = 64;
  ps.city.stats.unity = 66;
  ps.cityStress.threatPressure = 28;
  ps.cityStress.recoveryBurden = 16;
  ps.regionWar[0]!.threat = 44;
  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.heroes = [
    {
      id: "hero_chain_seed",
      ownerId: ps.playerId,
      name: "Kiera Vale",
      role: "scout",
      responseRoles: ["recon", "command"],
      traits: [],
      power: 94,
      tags: [],
      status: "idle",
      attachments: [],
    },
  ] as any;
  ps.armies = [
    {
      id: "army_chain_followup",
      cityId: ps.city.id,
      name: "Westwatch Cohort",
      type: "militia",
      power: 118,
      size: 300,
      readiness: 72,
      upkeep: { wealth: 9, materials: 6 },
      specialties: ["frontline", "defense", "command"],
      status: "idle",
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "mission_chain_seed",
      kind: "hero",
      difficulty: "medium",
      title: "Mark the Weakpoint",
      description: "Find the breach point before the raiders rotate.",
      regionId: ps.city.regionId,
      recommendedPower: 70,
      expectedRewards: { knowledge: 18, wealth: 14 },
      risk: { casualtyRisk: "moderate", heroInjuryRisk: "low" },
      responseTags: ["recon", "command"],
      threatFamily: "mercs",
    },
  ] as any;

  const firstActive = startMissionForPlayer(ps.playerId, "mission_chain_seed", now, "hero_chain_seed", undefined, "balanced");
  assert.ok(firstActive, "expected initial mission to start");
  firstActive!.finishesAt = now.toISOString();

  const firstResult = withRandomSequence([0.1, 0.08], () => completeMissionForPlayer(ps.playerId, firstActive!.instanceId, now));
  assert.equal(firstResult.status, "ok");
  const followup = firstResult.followupOffers?.[0];
  assert.ok(followup, "expected press-advantage follow-up");
  assert.equal(followup.followupChainKind, "press_advantage");

  const pressureBeforeFollowup = Number(ps.cityStress.threatPressure ?? 0);
  const threatBeforeFollowup = Number(ps.regionWar[0]!.threat ?? 0);
  const wealthBeforeFollowup = Number(ps.resources.wealth ?? 0);
  const materialsBeforeFollowup = Number(ps.resources.materials ?? 0);

  const followupActive = startMissionForPlayer(ps.playerId, followup!.id, now, undefined, "army_chain_followup", "aggressive");
  assert.ok(followupActive, "expected follow-up mission to start");
  followupActive!.finishesAt = now.toISOString();

  const followupResult = withRandomSequence([0.09, 0.06], () => completeMissionForPlayer(ps.playerId, followupActive!.instanceId, now));
  assert.equal(followupResult.status, "ok");
  assert.equal(followupResult.outcome?.kind, "success");
  assert.match(followupResult.receipt?.summary ?? "", /payoff window|Momentum held/i);
  assert.ok(Number(ps.cityStress.threatPressure ?? 0) <= pressureBeforeFollowup - 5, "expected pressure to drop from successful press-advantage chain resolution");
  assert.ok(Number(ps.regionWar[0]!.threat ?? 0) <= threatBeforeFollowup - 8, "expected region threat to drop from base mission effect plus chain payoff");
  assert.ok(Number(ps.resources.wealth ?? 0) >= wealthBeforeFollowup + 30, "expected follow-up to pay out more than its base wealth reward");
  assert.ok(Number(ps.resources.materials ?? 0) >= materialsBeforeFollowup + 40, "expected follow-up to pay out more than its base material reward");
});

test("failed containment follow-ups spike city burden and open a sharper escalation branch", () => {
  const ps = getOrCreatePlayerState("mission_followup_chain_failure_player");
  const now = new Date("2026-03-21T22:30:00Z");

  ps.resources.wealth = 1100;
  ps.resources.materials = 900;
  ps.resources.food = 520;
  ps.resources.unity = 170;
  ps.city.stats.security = 54;
  ps.city.stats.infrastructure = 50;
  ps.city.stats.unity = 58;
  ps.cityStress.threatPressure = 26;
  ps.cityStress.recoveryBurden = 10;
  ps.regionWar[0]!.threat = 58;
  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.armies = [
    {
      id: "army_failure_seed",
      cityId: ps.city.id,
      name: "Gateward Line",
      type: "militia",
      power: 88,
      size: 260,
      readiness: 38,
      upkeep: { wealth: 8, materials: 6 },
      specialties: ["frontline", "defense"],
      status: "idle",
    },
  ] as any;
  ps.heroes = [
    {
      id: "hero_failure_followup",
      ownerId: ps.playerId,
      name: "Mira Holt",
      role: "tactician",
      responseRoles: ["command", "recovery", "recon"],
      traits: [],
      power: 82,
      tags: [],
      status: "idle",
      attachments: [],
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "mission_failure_seed",
      kind: "army",
      difficulty: "high",
      title: "Hold the East Barricade",
      description: "Keep the breakthrough from rolling into the district.",
      regionId: ps.city.regionId,
      recommendedPower: 178,
      expectedRewards: { materials: 24, wealth: 16 },
      risk: { casualtyRisk: "severe" },
      responseTags: ["frontline", "defense"],
      threatFamily: "organized_hostile_forces",
    },
  ] as any;

  const firstActive = startMissionForPlayer(ps.playerId, "mission_failure_seed", now, undefined, "army_failure_seed", "cautious");
  assert.ok(firstActive, "expected initial mission to start");
  firstActive!.finishesAt = now.toISOString();

  const firstResult = withRandomSequence([0.96, 0.8], () => completeMissionForPlayer(ps.playerId, firstActive!.instanceId, now));
  assert.equal(firstResult.status, "ok");
  const followup = firstResult.followupOffers?.[0];
  assert.ok(followup, "expected containment follow-up");
  assert.equal(followup.followupChainKind, "contain_fallout");

  const pressureBefore = Number(ps.cityStress.threatPressure ?? 0);
  const burdenBefore = Number(ps.cityStress.recoveryBurden ?? 0);
  const unityBefore = Number(ps.city.stats.unity ?? 0);

  const followupActive = startMissionForPlayer(ps.playerId, followup!.id, now, "hero_failure_followup", undefined, "desperate");
  assert.ok(followupActive, "expected follow-up mission to start");
  followupActive!.finishesAt = now.toISOString();

  const followupResult = withRandomSequence([0.97, 0.88], () => completeMissionForPlayer(ps.playerId, followupActive!.instanceId, now));
  assert.equal(followupResult.status, "ok");
  assert.equal(followupResult.outcome?.kind, "failure");
  assert.match(followupResult.receipt?.summary ?? "", /dragging the whole district downward|Containment failed/i);
  assert.ok(Number(ps.cityStress.threatPressure ?? 0) >= pressureBefore + 9, "expected threat pressure spike after failed containment chain");
  assert.ok(Number(ps.cityStress.recoveryBurden ?? 0) >= burdenBefore + 8, "expected recovery burden spike after failed containment chain");
  assert.ok(Number(ps.city.stats.unity ?? 0) <= unityBefore - 4, "expected unity loss after failed containment chain");

  const nextFollowup = followupResult.followupOffers?.[0];
  assert.ok(nextFollowup, "expected a new escalation branch to open");
  assert.match(nextFollowup!.title, /Escalation/i);
  assert.ok(Number(nextFollowup!.targetingPressure ?? 0) >= 60, "expected escalation branch to advertise sharper pressure");
});


test("follow-up board merge keeps the sharper branch and surfaces it first when the same chain key reopens", () => {
  const regionId = "grayhaven" as any;
  const existing = [
    {
      id: "followup_seed_older",
      kind: "hero",
      difficulty: "medium",
      title: "Contain the Fallout in grayhaven",
      description: "Older containment branch.",
      regionId,
      recommendedPower: 96,
      expectedRewards: { influence: 10 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery"],
      threatFamily: "mercs",
      targetingPressure: 58,
      followupSourceMissionId: "mission_reopen_seed",
      followupChainKind: "contain_fallout",
      followupGeneratedByOutcome: "failure",
    },
    {
      id: "routine_low_pressure",
      kind: "hero",
      difficulty: "low",
      title: "Routine Patrol",
      description: "Background civic cleanup.",
      regionId,
      recommendedPower: 44,
      expectedRewards: { influence: 4 },
      risk: { casualtyRisk: "low" },
      responseTags: ["recon"],
      threatFamily: "mercs",
      targetingPressure: 14,
    },
  ] as any;

  const mergedBoard = __testOnlyMissionOfferMerge(existing, [
    {
      id: "followup_seed_newer",
      kind: "hero",
      difficulty: "high",
      title: "Contain the Fallout in grayhaven — Escalation 2",
      description: "Newer and sharper containment branch.",
      regionId,
      recommendedPower: 142,
      expectedRewards: { influence: 12, knowledge: 8 },
      risk: { casualtyRisk: "moderate", heroInjuryRisk: "moderate" },
      responseTags: ["command", "recovery", "recon"],
      threatFamily: "mercs",
      targetingPressure: 82,
      followupSourceMissionId: "mission_reopen_seed",
      followupChainKind: "contain_fallout",
      followupGeneratedByOutcome: "failure",
    },
    {
      id: "brand_new_low_signal",
      kind: "hero",
      difficulty: "low",
      title: "Minor Lead",
      description: "A low-pressure unrelated lead.",
      regionId,
      recommendedPower: 38,
      expectedRewards: { knowledge: 3 },
      risk: { casualtyRisk: "low" },
      responseTags: ["recon"],
      threatFamily: "mercs",
      targetingPressure: 12,
    },
  ] as any);

  const falloutOffers = mergedBoard.filter((offer) => offer.followupSourceMissionId === "mission_reopen_seed" && offer.followupChainKind === "contain_fallout");
  assert.equal(falloutOffers.length, 1, "expected duplicate chain branches to collapse to the sharper live offer");
  assert.equal(falloutOffers[0]!.id, "followup_seed_newer");
  assert.equal(mergedBoard[0]!.id, "followup_seed_newer", "expected the sharper branch to surface ahead of low-pressure board noise");
});


test("follow-up board merge drops expired chain offers and keeps fresh live pressure", () => {
  const now = new Date("2026-03-21T23:30:00Z");
  const regionId = "grayhaven" as any;
  const mergedBoard = __testOnlyMissionOfferMerge([
    {
      id: "expired_chain_offer",
      kind: "hero",
      difficulty: "high",
      title: "Contain the Fallout in grayhaven — Escalation 1",
      description: "Expired branch.",
      regionId,
      recommendedPower: 124,
      expectedRewards: { influence: 10 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery"],
      threatFamily: "mercs",
      targetingPressure: 78,
      followupSourceMissionId: "mission_expired_seed",
      followupRootMissionId: "mission_expired_seed",
      followupChainKind: "contain_fallout",
      followupChainDepth: 1,
      followupExpiresAt: "2026-03-21T23:00:00Z",
      followupGeneratedByOutcome: "failure",
    },
  ] as any, [
    {
      id: "fresh_chain_offer",
      kind: "hero",
      difficulty: "high",
      title: "Contain the Fallout in grayhaven — Escalation 2",
      description: "Fresh live branch.",
      regionId,
      recommendedPower: 132,
      expectedRewards: { influence: 12 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery", "recon"],
      threatFamily: "mercs",
      targetingPressure: 84,
      followupSourceMissionId: "mission_expired_seed",
      followupRootMissionId: "mission_expired_seed",
      followupChainKind: "contain_fallout",
      followupChainDepth: 2,
      followupExpiresAt: "2026-03-21T23:45:00Z",
      followupGeneratedByOutcome: "failure",
    },
  ] as any, now);

  assert.equal(mergedBoard.length, 1, "expected expired chain noise to be purged from the board");
  assert.equal(mergedBoard[0]!.id, "fresh_chain_offer");
});




test("crowded mission boards keep protected live branches instead of letting routine offer spam evict them", () => {
  const regionId = "grayhaven" as any;
  const routineOffers = Array.from({ length: 10 }, (_, index) => ({
    id: `routine_board_fill_${index + 1}`,
    kind: "hero",
    difficulty: "medium",
    title: `Routine Sweep ${index + 1}`,
    description: "Regular mission board noise.",
    regionId,
    recommendedPower: 72 + index,
    expectedRewards: { wealth: 6 },
    risk: { casualtyRisk: "low" },
    responseTags: ["recon"],
    threatFamily: "mercs",
    targetingPressure: 18,
  }));

  const mergedBoard = __testOnlyMissionOfferMerge(routineOffers as any, [
    {
      id: "live_chain_branch",
      kind: "hero",
      difficulty: "low",
      title: "Contain the Fallout in grayhaven",
      description: "Live chain pressure that should not be crowded out.",
      regionId,
      recommendedPower: 22,
      expectedRewards: { influence: 8 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery"],
      threatFamily: "mercs",
      targetingPressure: 4,
      followupSourceMissionId: "mission_crowded_board_seed",
      followupRootMissionId: "mission_crowded_board_seed",
      followupChainKind: "contain_fallout",
      followupChainDepth: 1,
      followupExpiresAt: "2026-03-22T01:00:00Z",
      followupGeneratedByOutcome: "failure",
    },
  ] as any, new Date("2026-03-22T00:00:00Z"));

  assert.equal(mergedBoard.length, 10);
  assert.ok(mergedBoard.some((offer) => offer.id === "live_chain_branch"), "expected the live branch to survive routine board crowding");
  assert.ok(mergedBoard.some((offer) => offer.id === "routine_board_fill_1"), "expected routine offers to still fill the non-reserved board space");
  assert.ok(!mergedBoard.some((offer) => offer.id === "routine_board_fill_10"), "expected the lowest-priority routine filler to lose its slot first");
});

test("follow-up chains stop reopening once the bounded escalation depth is exhausted", () => {
  const ps = getOrCreatePlayerState("mission_followup_depth_cap_player");
  const now = new Date("2026-03-21T23:45:00Z");

  ps.resources.wealth = 1200;
  ps.resources.materials = 1100;
  ps.resources.food = 700;
  ps.resources.unity = 180;
  ps.city.stats.security = 68;
  ps.city.stats.infrastructure = 66;
  ps.city.stats.unity = 69;
  ps.cityStress.threatPressure = 26;
  ps.cityStress.recoveryBurden = 10;
  ps.regionWar[0]!.threat = 52;
  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.heroes = [
    {
      id: "hero_depth_cap",
      ownerId: ps.playerId,
      name: "Serin Holt",
      role: "captain",
      responseRoles: ["command", "recovery"],
      traits: [],
      power: 104,
      tags: [],
      status: "idle",
      attachments: [],
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "followup_depth_cap_seed",
      kind: "hero",
      difficulty: "high",
      title: "Contain the Fallout in grayhaven — Escalation 3",
      description: "This branch is already at the cap.",
      regionId: ps.city.regionId,
      recommendedPower: 148,
      expectedRewards: { influence: 14, knowledge: 10 },
      risk: { casualtyRisk: "moderate", heroInjuryRisk: "moderate" },
      responseTags: ["command", "recovery", "recon"],
      threatFamily: "mercs",
      targetingPressure: 88,
      followupSourceMissionId: "followup_depth_cap_parent",
      followupRootMissionId: "mission_depth_cap_root",
      followupChainKind: "contain_fallout",
      followupChainDepth: 3,
      followupExpiresAt: "2026-03-22T00:10:00Z",
      followupGeneratedByOutcome: "failure",
    },
  ] as any;

  const active = startMissionForPlayer(ps.playerId, "followup_depth_cap_seed", now, "hero_depth_cap", undefined, "balanced");
  assert.ok(active, "expected capped follow-up mission to start");
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.96, 0.82], () => completeMissionForPlayer(ps.playerId, active!.instanceId, now));
  assert.equal(result.status, "ok");
  assert.equal(result.outcome?.kind, "failure");
  assert.equal(result.followupOffers?.length ?? 0, 0, "expected no new branch once chain depth cap is reached");
  assert.ok(!(ps.currentOffers ?? []).some((offer) => offer.followupRootMissionId === "mission_depth_cap_root"), "expected capped branch to clear instead of reopening forever");
});


test("crowded mission boards throttle protected offers from the same chain family before evicting unrelated live branches", () => {
  const regionId = "grayhaven" as any;
  const routineOffers = Array.from({ length: 8 }, (_, index) => ({
    id: `routine_family_fill_${index + 1}`,
    kind: "hero",
    difficulty: "medium",
    title: `Routine Sweep Family ${index + 1}`,
    description: "Regular mission board noise.",
    regionId,
    recommendedPower: 60 + index,
    expectedRewards: { wealth: 5 },
    risk: { casualtyRisk: "low" },
    responseTags: ["recon"],
    threatFamily: "mercs",
    targetingPressure: 16,
  }));

  const mergedBoard = __testOnlyMissionOfferMerge(routineOffers as any, [
    {
      id: "chain_family_a_1",
      kind: "hero",
      difficulty: "high",
      title: "Contain the Fallout in grayhaven",
      description: "First live branch from the same chain family.",
      regionId,
      recommendedPower: 118,
      expectedRewards: { influence: 8 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery"],
      threatFamily: "mercs",
      targetingPressure: 68,
      followupSourceMissionId: "mission_family_seed_a_parent_1",
      followupRootMissionId: "mission_family_seed_a",
      followupChainKind: "contain_fallout",
      followupChainDepth: 1,
      followupExpiresAt: "2026-03-22T01:00:00Z",
      followupGeneratedByOutcome: "failure",
    },
    {
      id: "chain_family_a_2",
      kind: "hero",
      difficulty: "high",
      title: "Contain the Fallout in grayhaven — Escalation 2",
      description: "Second live branch from the same chain family.",
      regionId,
      recommendedPower: 126,
      expectedRewards: { influence: 10 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery", "recon"],
      threatFamily: "mercs",
      targetingPressure: 76,
      followupSourceMissionId: "mission_family_seed_a_parent_2",
      followupRootMissionId: "mission_family_seed_a",
      followupChainKind: "contain_fallout",
      followupChainDepth: 2,
      followupExpiresAt: "2026-03-22T01:00:00Z",
      followupGeneratedByOutcome: "failure",
    },
    {
      id: "chain_family_b_1",
      kind: "hero",
      difficulty: "high",
      title: "Secure the Gains in grayhaven",
      description: "Different live chain family that should still survive.",
      regionId,
      recommendedPower: 116,
      expectedRewards: { wealth: 10 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "frontline"],
      threatFamily: "mercs",
      targetingPressure: 70,
      followupSourceMissionId: "mission_family_seed_b_parent_1",
      followupRootMissionId: "mission_family_seed_b",
      followupChainKind: "secure_gains",
      followupChainDepth: 1,
      followupExpiresAt: "2026-03-22T01:00:00Z",
      followupGeneratedByOutcome: "success",
    },
  ] as any, new Date("2026-03-22T00:00:00Z"));

  assert.equal(mergedBoard.length, 10);
  assert.ok(mergedBoard.some((offer) => offer.id === "chain_family_b_1"), "expected unrelated live branch family to survive protected reservation");
  assert.ok(mergedBoard.some((offer) => offer.id === "chain_family_a_2"), "expected the sharper representative from chain family A to survive");
  assert.ok(!mergedBoard.some((offer) => offer.id === "chain_family_a_1"), "expected lower-priority duplicate family representative to yield its slot");
  assert.ok(mergedBoard.some((offer) => offer.id === "routine_family_fill_1"), "expected routine offers to continue filling the remaining board space");
});


test("crowded mission boards keep a recovery contract and a live follow-up branch visible at the same time", () => {
  const regionId = "grayhaven" as any;
  const routineOffers = Array.from({ length: 10 }, (_, index) => ({
    id: `routine_mixed_fill_${index + 1}`,
    kind: "hero",
    difficulty: "medium",
    title: `Routine Mixed Sweep ${index + 1}`,
    description: "Regular mission board noise.",
    regionId,
    recommendedPower: 70 + index,
    expectedRewards: { wealth: 6 },
    risk: { casualtyRisk: "low" },
    responseTags: ["recon"],
    threatFamily: "mercs",
    targetingPressure: 20,
  }));

  const mergedBoard = __testOnlyMissionOfferMerge(routineOffers as any, [
    {
      id: "protected_contract_branch",
      kind: "hero",
      difficulty: "high",
      title: "Recovery contract: stabilize the district",
      description: "City recovery work that should remain visible.",
      regionId,
      recommendedPower: 112,
      expectedRewards: { unity: 10 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery"],
      threatFamily: "desperate_towns",
      targetingPressure: 58,
      contractKind: "stabilize_district",
    },
    {
      id: "protected_followup_branch",
      kind: "hero",
      difficulty: "high",
      title: "Contain the Fallout in grayhaven",
      description: "Live fallout pressure that should remain visible.",
      regionId,
      recommendedPower: 120,
      expectedRewards: { influence: 9 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery"],
      threatFamily: "mercs",
      targetingPressure: 74,
      followupSourceMissionId: "mission_mixed_board_seed",
      followupRootMissionId: "mission_mixed_board_seed",
      followupChainKind: "contain_fallout",
      followupChainDepth: 1,
      followupExpiresAt: "2026-03-22T01:00:00Z",
      followupGeneratedByOutcome: "failure",
    },
  ] as any, new Date("2026-03-22T00:00:00Z"));

  assert.equal(mergedBoard.length, 10);
  assert.ok(mergedBoard.some((offer) => offer.id === "protected_contract_branch"), "expected recovery contract to survive protected reservation");
  assert.ok(mergedBoard.some((offer) => offer.id === "protected_followup_branch"), "expected live follow-up branch to survive protected reservation");
  assert.ok(mergedBoard.some((offer) => offer.id === "routine_mixed_fill_1"), "expected routine offers to continue filling non-reserved board space");
  assert.ok(!mergedBoard.some((offer) => offer.id === "routine_mixed_fill_10"), "expected the last routine filler to yield once both protected slots are occupied");
});

test("mission board merge stays stable across repeated merges with the same protected families", () => {
  const regionId = "grayhaven" as any;
  const routineOffers = Array.from({ length: 8 }, (_, index) => ({
    id: `routine_repeat_fill_${index + 1}`,
    kind: "hero",
    difficulty: "medium",
    title: `Routine Repeat Sweep ${index + 1}`,
    description: "Regular mission board noise.",
    regionId,
    recommendedPower: 64 + index,
    expectedRewards: { wealth: 5 },
    risk: { casualtyRisk: "low" },
    responseTags: ["recon"],
    threatFamily: "mercs",
    targetingPressure: 18,
  }));

  const protectedOffers = [
    {
      id: "repeat_family_a",
      kind: "hero",
      difficulty: "high",
      title: "Contain the Fallout in grayhaven",
      description: "Repeat family A protected branch.",
      regionId,
      recommendedPower: 122,
      expectedRewards: { influence: 10 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "recovery"],
      threatFamily: "mercs",
      targetingPressure: 78,
      followupSourceMissionId: "mission_repeat_seed_a_parent",
      followupRootMissionId: "mission_repeat_seed_a",
      followupChainKind: "contain_fallout",
      followupChainDepth: 2,
      followupExpiresAt: "2026-03-22T01:00:00Z",
      followupGeneratedByOutcome: "failure",
    },
    {
      id: "repeat_family_b",
      kind: "hero",
      difficulty: "high",
      title: "Secure the Gains in grayhaven",
      description: "Repeat family B protected branch.",
      regionId,
      recommendedPower: 116,
      expectedRewards: { wealth: 10 },
      risk: { casualtyRisk: "moderate" },
      responseTags: ["command", "frontline"],
      threatFamily: "mercs",
      targetingPressure: 70,
      followupSourceMissionId: "mission_repeat_seed_b_parent",
      followupRootMissionId: "mission_repeat_seed_b",
      followupChainKind: "secure_gains",
      followupChainDepth: 1,
      followupExpiresAt: "2026-03-22T01:00:00Z",
      followupGeneratedByOutcome: "success",
    },
  ];

  const mergedOnce = __testOnlyMissionOfferMerge(routineOffers as any, protectedOffers as any, new Date("2026-03-22T00:00:00Z"));
  const mergedTwice = __testOnlyMissionOfferMerge(mergedOnce as any, protectedOffers as any, new Date("2026-03-22T00:00:00Z"));

  assert.deepEqual(
    mergedTwice.map((offer) => offer.id),
    mergedOnce.map((offer) => offer.id),
    "expected repeated merges with the same protected families to remain stable",
  );
});


test("failed containment follow-ups immediately surface recovery contracts when city strain tips into settlement trouble", () => {
  const ps = getOrCreatePlayerState("mission_followup_recovery_contract_player");
  const now = new Date("2026-03-22T10:00:00Z");

  ps.activeMissions = [];
  ps.missionReceipts = [];
  ps.currentOffers = [];
  ps.worldConsequences = [];
  ps.worldConsequenceState = undefined as any;

  ps.resources.wealth = 1200;
  ps.resources.materials = 900;
  ps.resources.food = 180;
  ps.resources.unity = 170;

  ps.city.stats.security = 64;
  ps.city.stats.stability = 62;
  ps.city.stats.infrastructure = 58;
  ps.city.stats.unity = 72;

  ps.cityStress.threatPressure = 18;
  ps.cityStress.recoveryBurden = 4;

  ps.regionWar[0]!.threat = 34;
  ps.city.regionId = ps.regionWar[0]!.regionId as any;

  ps.heroes = [
    {
      id: "hero_chain_failure_recovery",
      ownerId: ps.playerId,
      name: "Mara Flint",
      role: "champion",
      responseRoles: ["frontline", "command"],
      traits: [],
      power: 88,
      tags: [],
      status: "idle",
      attachments: [],
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "mission_followup_recovery_seed",
      kind: "hero",
      difficulty: "high",
      title: "Seal the Alley Breach",
      description: "Hold the breach long enough for the district to regroup.",
      regionId: ps.city.regionId,
      recommendedPower: 82,
      expectedRewards: { influence: 18, knowledge: 10 },
      risk: { casualtyRisk: "high", heroInjuryRisk: "moderate" },
      responseTags: ["frontline", "command"],
      threatFamily: "organized_hostile_forces",
      followupChainKind: "contain_fallout",
      followupRootMissionId: "mission_followup_recovery_seed",
      followupChainDepth: 1,
      followupGeneratedByOutcome: "failure",
    },
  ] as any;

  assert.ok(
    !(ps.currentOffers ?? []).some((offer) => offer.contractKind),
    "expected no preexisting recovery contracts before the failed follow-up",
  );

  const active = startMissionForPlayer(
    ps.playerId,
    "mission_followup_recovery_seed",
    now,
    "hero_chain_failure_recovery",
    undefined,
    "desperate",
  );
  assert.ok(active, "expected containment follow-up to start");
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.5, 0.99, 0.62], () =>
    completeMissionForPlayer(ps.playerId, active!.instanceId, now),
  );

  assert.equal(result.status, "ok");
  assert.ok(
    result.outcome?.kind === "failure" || result.outcome?.kind === "partial",
    `expected containment follow-up to resolve badly enough to trigger recovery pressure, got ${result.outcome?.kind}`,
  );
  assert.ok(
    (ps.cityStress.recoveryBurden ?? 0) > 4,
    "expected containment fallout to increase recovery burden",
  );
  assert.ok(
    (ps.cityStress.threatPressure ?? 0) > 18,
    "expected containment fallout to increase city pressure",
  );
  assert.ok(
    (result.recoveryOffers?.length ?? 0) >= 1 ||
      (ps.currentOffers ?? []).some((offer) => offer.contractKind),
    "expected settlement recovery contracts to be available immediately after the failed chain",
  );
  assert.ok(
    [...(result.recoveryOffers ?? []), ...(ps.currentOffers ?? [])].some(
      (offer) =>
        offer.contractKind === "stabilize_district" ||
        offer.contractKind === "repair_works" ||
        offer.contractKind === "relief_convoys",
    ),
    "expected a real recovery contract instead of only another combat branch",
  );
  assert.ok(
    (ps.currentOffers ?? []).some((offer) => offer.contractKind),
    "expected the live board to contain at least one recovery contract after the failed chain",
  );
});
