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
  ps.city.settlementLane = "black_market";
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

test("ignored recovery strain exports bridge-snapshot pressure into world consequence state over time", () => {
  const ps = getOrCreatePlayerState("world_consequence_bridge_snapshot_player");
  const now = new Date("2026-03-23T10:00:00Z");

  ps.currentOffers = [];
  ps.activeMissions = [];
  ps.missionReceipts = [];
  ps.worldConsequences = [];
  ps.worldConsequenceState = undefined as any;
  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.regionWar[0]!.threat = 44;
  ps.resources.food = 160;
  ps.resources.unity = 88;
  ps.city.stats.infrastructure = 41;
  ps.city.stats.stability = 60;
  ps.city.stats.security = 58;
  ps.city.stats.unity = 62;
  ps.cityStress.recoveryBurden = 34;
  ps.cityStress.threatPressure = 32;
  ps.lastTickAt = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

  tickPlayerState(ps, now);

  const snapshot = (ps.worldConsequences ?? []).find((entry) => entry.source === "bridge_snapshot");
  assert.ok(snapshot, "expected a bridge snapshot export from ignored recovery strain");
  assert.ok(snapshot?.contractKind, "expected exported snapshot to identify the dominant recovery lane");
  assert.ok(snapshot?.tags.includes("city_pressure_export"));
  assert.ok(snapshot?.tags.includes("world_economy_hook"));

  const state = ps.worldConsequenceState;
  assert.ok(state, "expected propagated world consequence state after ignored recovery export");
  const region = state.regions.find((entry) => entry.regionId === ps.city.regionId);
  assert.ok(region, "expected exported pressure to reach the city region");
  assert.ok((region?.netPressure ?? 0) > 0, "expected exported pressure to raise regional net pressure");
  assert.ok((region?.netRecoveryLoad ?? 0) > 0, "expected exported pressure to carry recovery load outward");
  assert.ok(state.worldEconomy.tradePressure > 0 || state.worldEconomy.supplyFriction > 0, "expected world economy hooks to wake up from ignored recovery strain");
});


test("city stabilization exports cooling bridge snapshots once recovery pressure subsides", () => {
  const ps = getOrCreatePlayerState("world_consequence_bridge_cooling_player");
  const firstTick = new Date("2026-03-23T10:00:00Z");

  ps.currentOffers = [];
  ps.activeMissions = [];
  ps.missionReceipts = [];
  ps.worldConsequences = [];
  ps.worldConsequenceState = undefined as any;
  ps.city.regionId = ps.regionWar[0]!.regionId as any;
  ps.regionWar[0]!.threat = 48;
  ps.resources.food = 150;
  ps.resources.unity = 86;
  ps.city.stats.infrastructure = 42;
  ps.city.stats.stability = 58;
  ps.city.stats.security = 56;
  ps.city.stats.unity = 60;
  ps.cityStress.recoveryBurden = 36;
  ps.cityStress.threatPressure = 34;
  ps.lastTickAt = new Date(firstTick.getTime() - 4 * 60 * 60 * 1000).toISOString();

  tickPlayerState(ps, firstTick);

  const beforeTrade = ps.worldConsequenceState?.worldEconomy.tradePressure ?? 0;
  const beforeDestabilization = ps.worldConsequenceState?.summary.destabilizationScore ?? 0;
  const firstSnapshotCount = (ps.worldConsequences ?? []).filter((entry) => entry.source === "bridge_snapshot").length;
  assert.ok(firstSnapshotCount >= 1, "expected an initial pressure export before cooling");

  const secondTick = new Date("2026-03-23T14:30:00Z");
  ps.currentOffers = [];
  ps.activeMissions = [];
  ps.regionWar[0]!.threat = 12;
  ps.city.stats.infrastructure = 72;
  ps.city.stats.stability = 74;
  ps.city.stats.security = 70;
  ps.city.stats.unity = 71;
  ps.cityStress.recoveryBurden = 6;
  ps.cityStress.threatPressure = 8;
  ps.cityStress.total = 12;
  ps.lastTickAt = new Date(secondTick.getTime() - 4 * 60 * 60 * 1000).toISOString();

  tickPlayerState(ps, secondTick);

  const coolingSnapshot = (ps.worldConsequences ?? []).find(
    (entry) => entry.source === "bridge_snapshot" && Number(entry.metrics?.pressureDelta ?? 0) < 0 && Number(entry.metrics?.recoveryDelta ?? 0) < 0,
  );
  assert.ok(coolingSnapshot, "expected a cooling bridge snapshot after stabilization");
  assert.match(coolingSnapshot?.summary ?? "", /cooling exported regional pressure|stabilization/i);
  assert.ok(coolingSnapshot?.tags.includes("city_pressure_export"));
  assert.ok(coolingSnapshot?.tags.includes("world_economy_hook"));

  const state = ps.worldConsequenceState;
  assert.ok(state, "expected propagated world consequence state after stabilization export");
  assert.ok((state.worldEconomy.tradePressure ?? 0) < beforeTrade, "expected stabilization export to cool world trade pressure");
  assert.ok((state.summary.destabilizationScore ?? 0) < beforeDestabilization, "expected stabilization export to cool overall destabilization");
  assert.match(state.summary.note, /cooling previously exported regional pressure|propagat/i);
});
