//web-backend/test/armyReadinessResponse.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  getOrCreatePlayerState,
  raiseArmyForPlayer,
  reinforceArmyForPlayer,
  startMissionForPlayer,
  completeMissionForPlayer,
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

test("raised and reinforced armies expose readiness/upkeep and reinforcement restores readiness", () => {
  const ps = getOrCreatePlayerState("army_raise_reinforce_player");
  ps.resources.materials = 2000;
  ps.resources.wealth = 2000;

  const raised = withRandomSequence([0.12], () =>
    raiseArmyForPlayer(ps.playerId, "line", new Date("2026-03-18T10:00:00Z")),
  );
  assert.equal(raised.status, "ok");
  assert.ok(raised.army);
  assert.ok(typeof raised.army?.readiness === "number");
  assert.ok((raised.army?.upkeep.wealth ?? 0) > 0);
  assert.ok((raised.army?.upkeep.materials ?? 0) > 0);
  assert.ok((raised.army?.specialties.length ?? 0) > 0);

  const beforeReadiness = raised.army!.readiness;
  raised.army!.readiness = 41;

  const reinforced = reinforceArmyForPlayer(ps.playerId, raised.army!.id, new Date("2026-03-18T10:05:00Z"));
  assert.equal(reinforced.status, "ok");
  assert.ok(reinforced.army);
  assert.ok((reinforced.army?.readiness ?? 0) > 41);
  assert.ok((reinforced.army?.upkeep.wealth ?? 0) >= (raised.army?.upkeep.wealth ?? 0));
  assert.notEqual(beforeReadiness, reinforced.army?.readiness);
});

test("manual army assignment changes outcomes when readiness and specialties fit the lane", () => {
  const ps = getOrCreatePlayerState("army_assignment_player");
  const now = new Date("2026-03-18T12:00:00Z");

  ps.armies = [
    {
      id: "army_bad",
      cityId: ps.city.id,
      name: "Tired Field Levy",
      type: "militia",
      power: 118,
      size: 320,
      readiness: 33,
      upkeep: { wealth: 9, materials: 6 },
      specialties: ["defense", "recovery"],
      status: "idle",
    },
    {
      id: "army_good",
      cityId: ps.city.id,
      name: "Storm Vanguard",
      type: "vanguard",
      power: 118,
      size: 260,
      readiness: 94,
      upkeep: { wealth: 11, materials: 7 },
      specialties: ["frontline", "command", "recon"],
      status: "idle",
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "army_lane_test",
      kind: "army",
      difficulty: "high",
      title: "Break the Siege Ring",
      description: "Test army assignment weighting.",
      regionId: ps.city.regionId,
      recommendedPower: 130,
      expectedRewards: { materials: 40 },
      risk: { casualtyRisk: "severe" },
      responseTags: ["frontline", "command"],
    },
  ];

  const badActive = startMissionForPlayer(ps.playerId, "army_lane_test", now, undefined, "army_bad");
  assert.ok(badActive);
  badActive!.finishesAt = now.toISOString();

  const badOutcome = withRandomSequence([0.78, 0.2], () =>
    completeMissionForPlayer(ps.playerId, badActive!.instanceId, now),
  );
  assert.equal(badOutcome.status, "ok");
  assert.ok((badOutcome.outcome?.successChance ?? 0) > 0);

  ps.currentOffers = [
    {
      id: "army_lane_test_retry",
      kind: "army",
      difficulty: "high",
      title: "Break the Siege Ring",
      description: "Test army assignment weighting.",
      regionId: ps.city.regionId,
      recommendedPower: 130,
      expectedRewards: { materials: 40 },
      risk: { casualtyRisk: "severe" },
      responseTags: ["frontline", "command"],
    },
  ];

  const goodActive = startMissionForPlayer(ps.playerId, "army_lane_test_retry", now, undefined, "army_good");
  assert.ok(goodActive);
  goodActive!.finishesAt = now.toISOString();

  const goodOutcome = withRandomSequence([0.54, 0.18], () =>
    completeMissionForPlayer(ps.playerId, goodActive!.instanceId, now),
  );
  assert.equal(goodOutcome.status, "ok");
  assert.ok((goodOutcome.outcome?.successChance ?? 0) > (badOutcome.outcome?.successChance ?? 0), "better readiness and lane fit should improve the mission odds");
  assert.notEqual(goodOutcome.outcome?.kind, "failure");
});
