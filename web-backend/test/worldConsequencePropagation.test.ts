//web-backend/test/worldConsequencePropagation.test.ts

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

test("mission setback propagates into regional, faction, and economy pressure state", () => {
  const ps = getOrCreatePlayerState("world_consequence_propagation_player");
  const now = new Date("2026-03-18T22:00:00Z");

  ps.resources.wealth = 600;
  ps.resources.materials = 600;
  ps.resources.unity = 125;
  ps.city.stats.security = 58;
  ps.city.stats.stability = 57;
  ps.city.stats.unity = 60;
  ps.city.stats.infrastructure = 52;
  ps.techFlags = ["BLACK_MARKET_ENABLED"];
  ps.armies = [
    {
      id: "army_consequence_chain",
      cityId: ps.city.id,
      name: "Frayed Wall Watch",
      type: "militia",
      power: 88,
      size: 250,
      readiness: 34,
      upkeep: { wealth: 8, materials: 5 },
      specialties: ["defense", "recovery"],
      status: "idle",
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "world_propagation_test",
      kind: "army",
      difficulty: "high",
      title: "Contain the Broken Route",
      description: "Raiders are cutting off caravan routes.",
      regionId: ps.city.regionId,
      recommendedPower: 165,
      expectedRewards: { materials: 40 },
      risk: { casualtyRisk: "severe" },
      responseTags: ["frontline", "command"],
      threatFamily: "organized_hostile_forces",
    },
  ] as any;

  const active = startMissionForPlayer(ps.playerId, "world_propagation_test", now, undefined, "army_consequence_chain", "desperate");
  assert.ok(active);
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.92, 0.63], () => completeMissionForPlayer(ps.playerId, active!.instanceId, now));
  assert.equal(result.status, "ok");
  assert.equal(result.outcome?.kind, "failure");

  const state = ps.worldConsequenceState;
  assert.ok(state, "expected propagated world consequence state");
  assert.ok(state.regions.length >= 1);
  const region = state.regions.find((entry) => entry.regionId === ps.city.regionId);
  assert.ok(region, "expected propagated region signal for city region");
  assert.ok((region?.tradeDisruption ?? 0) > 0);
  assert.ok((region?.factionDrift ?? 0) > 0);
  assert.ok(state.worldEconomy.tradePressure > 0);
  assert.ok(state.worldEconomy.cartelAttention > 0);
  assert.ok(state.blackMarket.opportunityScore > 0);
  assert.notEqual(state.blackMarket.outlook, "quiet");
  assert.notEqual(state.factionPressure.dominantStance, "stable");
  assert.match(state.summary.note, /propagat|black-market|destabilizing/i);
});

test("recovery contracts propagate reduced threat and persistent recovery load into world consequence state", () => {
  const ps = getOrCreatePlayerState("world_consequence_recovery_propagation_player");
  const now = new Date("2026-03-18T22:20:00Z");

  ps.resources.wealth = 2000;
  ps.resources.materials = 2000;
  ps.resources.mana = 1200;
  ps.resources.unity = 100;
  ps.city.stats.unity = 46;
  ps.cityStress.recoveryBurden = 52;
  ps.cityStress.threatPressure = 48;
  ps.heroes = [
    {
      id: "hero_recover_world_chain",
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
  ] as any;

  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.regionWar[0]!.threat = 65;
  tickPlayerState(ps, now);
  const contract = ps.currentOffers.find((offer) => offer.contractKind === "stabilize_district") ?? ps.currentOffers.find((offer) => offer.contractKind);
  assert.ok(contract, "expected a recovery contract");

  const active = startMissionForPlayer(ps.playerId, contract!.id, now, "hero_recover_world_chain", undefined, "balanced");
  assert.ok(active);
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.24, 0.14], () => completeMissionForPlayer(ps.playerId, active!.instanceId, now));
  assert.equal(result.status, "ok");

  const state = ps.worldConsequenceState;
  const region = state.regions.find((entry) => entry.regionId === contract!.regionId);
  assert.ok(region, "expected propagated region signal for recovery region");
  assert.ok((region?.netRecoveryLoad ?? 0) !== 0);
  assert.ok(state.summary.affectedRegionIds.includes(String(contract!.regionId)));
  assert.ok(state.lastUpdatedAt);
});
