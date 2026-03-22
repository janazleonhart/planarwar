//web-backend/test/recoveryStabilizationContracts.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  completeMissionForPlayer,
  getOrCreatePlayerState,
  startMissionForPlayer,
  tickPlayerState,
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

test("recovery contracts appear when city burden and pressure stay elevated", () => {
  const ps = getOrCreatePlayerState("recovery_contract_offer_player");
  const now = new Date("2026-03-18T18:00:00Z");

  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.regionWar[0]!.threat = 72;
  ps.city.stats.unity = 44;
  ps.cityStress.recoveryBurden = 51;

  tickPlayerState(ps, now);

  const contracts = ps.currentOffers.filter((offer) => offer.contractKind);
  assert.ok(contracts.length >= 1, "expected at least one city recovery contract");
  assert.ok(contracts.every((offer) => offer.responseTags.includes("recovery")), "recovery contracts should advertise recovery lanes");
});

test("recovery contract outcomes change burden, pressure, and trust directionally", () => {
  const ps = getOrCreatePlayerState("recovery_contract_resolution_player");
  const now = new Date("2026-03-18T18:30:00Z");

  ps.resources.wealth = 2000;
  ps.resources.materials = 2000;
  ps.resources.mana = 1200;
  ps.resources.unity = 100;
  ps.city.stats.unity = 46;
  ps.cityStress.recoveryBurden = 52;
  ps.cityStress.threatPressure = 48;
  ps.heroes = [
    {
      id: "hero_recover_good",
      ownerId: ps.playerId,
      name: "Aster Vale",
      role: "tactician",
      responseRoles: ["command", "recovery"],
      traits: [{ id: "steady", name: "Steady", polarity: "pro", summary: "Excellent at stabilization work.", responseBias: { command: 12, recovery: 16 } }],
      power: 92,
      tags: [],
      status: "idle",
      attachments: [],
    },
    {
      id: "hero_recover_bad",
      ownerId: ps.playerId,
      name: "Panic Joss",
      role: "champion",
      responseRoles: ["frontline"],
      traits: [{ id: "blunt", name: "Blunt", polarity: "con", summary: "Poor at public reassurance.", responseBias: { command: -12, recovery: -10 } }],
      power: 70,
      tags: [],
      status: "idle",
      attachments: [],
    },
  ] as any;

  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.regionWar[0]!.threat = 65;
  tickPlayerState(ps, now);
  const contractBase = ps.currentOffers.find((offer) => offer.contractKind === "stabilize_district") ?? ps.currentOffers.find((offer) => offer.contractKind);
  assert.ok(contractBase, "expected a generated recovery contract");

  const burdenBeforeSuccess = ps.cityStress.recoveryBurden;

  const activeSuccess = startMissionForPlayer(ps.playerId, contractBase!.id, now, "hero_recover_good", undefined, "balanced");
  assert.ok(activeSuccess);
  activeSuccess!.finishesAt = now.toISOString();

  const successResult = withRandomSequence([0.24, 0.14], () =>
    completeMissionForPlayer(ps.playerId, activeSuccess!.instanceId, now),
  );
  assert.equal(successResult.status, "ok");
  assert.ok((ps.cityStress.recoveryBurden ?? 0) < burdenBeforeSuccess, "successful contracts should reduce recovery burden");

  const burdenBeforeFailure = ps.cityStress.recoveryBurden;
  const trustBeforeFailure = ps.city.stats.unity;
  const pressureBeforeFailure = ps.cityStress.threatPressure;

  tickPlayerState(ps, now);
  const followupContract = ps.currentOffers.find((offer) => offer.contractKind === contractBase!.contractKind) ?? ps.currentOffers.find((offer) => offer.contractKind);
  assert.ok(followupContract, "expected a follow-up recovery contract after the first resolution");
  const activeFailure = startMissionForPlayer(ps.playerId, followupContract!.id, now, "hero_recover_bad", undefined, "desperate");
  assert.ok(activeFailure);
  activeFailure!.finishesAt = now.toISOString();

  const failureResult = withRandomSequence([0.97, 0.45], () =>
    completeMissionForPlayer(ps.playerId, activeFailure!.instanceId, now),
  );
  assert.equal(failureResult.status, "ok");
  assert.ok((ps.cityStress.recoveryBurden ?? 0) > burdenBeforeFailure, "failed contracts should increase recovery burden");
  assert.ok((ps.city.stats.unity ?? 0) < trustBeforeFailure, "failed contracts should damage trust/unity");
  assert.ok((ps.cityStress.threatPressure ?? 0) >= pressureBeforeFailure, "failed contracts should worsen or sustain pressure");
});


test("recovery contract lanes now hit distinct settlement stats and supplies", () => {
  const now = new Date("2026-03-22T14:00:00Z");

  const repair = getOrCreatePlayerState("recovery_lane_repair_player");
  repair.resources.wealth = 2500;
  repair.resources.materials = 2500;
  repair.resources.food = 2500;
  repair.city.regionId = repair.regionWar[0]!.regionId as any;
  repair.regionWar[0]!.threat = 78;
  repair.cityStress.recoveryBurden = 42;
  repair.cityStress.threatPressure = 58;
  repair.city.stats.infrastructure = 41;
  repair.armies = [{
    id: "army_repair_lane",
    ownerId: repair.playerId,
    name: "Mason Guard",
    power: 140,
    size: 160,
    status: "idle",
    specialties: ["defense", "frontline"],
    readiness: 88,
    upkeep: { wealth: 10, materials: 7 },
  }] as any;
  tickPlayerState(repair, now);
  const repairContract = repair.currentOffers.find((offer) => offer.contractKind === "repair_works");
  assert.ok(repairContract, "expected repair contract to be available");
  const infraBefore = repair.city.stats.infrastructure;
  const repairActive = startMissionForPlayer(repair.playerId, repairContract!.id, now, undefined, "army_repair_lane", "balanced");
  assert.ok(repairActive);
  repairActive!.finishesAt = now.toISOString();
  const repairResult = withRandomSequence([0.2, 0.12], () => completeMissionForPlayer(repair.playerId, repairActive!.instanceId, now));
  assert.equal(repairResult.status, "ok");
  assert.ok((repair.city.stats.infrastructure ?? 0) >= infraBefore + 6, "successful repair works should materially improve infrastructure");
  assert.match(repairResult.receipt?.summary ?? "", /infrastructure improved by 6/i);

  const relief = getOrCreatePlayerState("recovery_lane_relief_player");
  relief.resources.wealth = 2500;
  relief.resources.materials = 2500;
  relief.resources.food = 180;
  relief.city.regionId = relief.regionWar[0]!.regionId as any;
  relief.regionWar[0]!.threat = 76;
  relief.cityStress.recoveryBurden = 28;
  relief.cityStress.threatPressure = 62;
  relief.armies = [{
    id: "army_relief_lane",
    ownerId: relief.playerId,
    name: "Convoy Lancers",
    power: 132,
    size: 150,
    status: "idle",
    specialties: ["defense", "command"],
    readiness: 86,
    upkeep: { wealth: 10, materials: 6 },
  }] as any;
  tickPlayerState(relief, now);
  const reliefContract = relief.currentOffers.find((offer) => offer.contractKind === "relief_convoys");
  assert.ok(reliefContract, "expected relief convoy contract to be available");
  const foodBefore = Number(relief.resources.food ?? 0);
  const reliefActive = startMissionForPlayer(relief.playerId, reliefContract!.id, now, undefined, "army_relief_lane", "balanced");
  assert.ok(reliefActive);
  reliefActive!.finishesAt = now.toISOString();
  const reliefResult = withRandomSequence([0.22, 0.14], () => completeMissionForPlayer(relief.playerId, reliefActive!.instanceId, now));
  assert.equal(reliefResult.status, "ok");
  assert.ok(Number(relief.resources.food ?? 0) >= foodBefore + 50, "successful relief convoys should restore food on top of mission rewards");
  assert.match(reliefResult.receipt?.summary ?? "", /food reserves rose by 28/i);
});
