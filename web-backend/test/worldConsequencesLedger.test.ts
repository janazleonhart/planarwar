//web-backend/test/worldConsequencesLedger.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  completeMissionForPlayer,
  getOrCreatePlayerState,
  startMissionForPlayer,
  summarizePlayerWorldConsequences,
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

test("failed mission setbacks are exported into the world consequence ledger", () => {
  const ps = getOrCreatePlayerState("world_consequence_setback_player");
  const now = new Date("2026-03-18T20:00:00Z");

  ps.resources.wealth = 500;
  ps.resources.materials = 500;
  ps.resources.unity = 120;
  ps.city.stats.security = 58;
  ps.city.stats.stability = 57;
  ps.city.stats.unity = 60;
  ps.city.stats.infrastructure = 52;
  ps.armies = [
    {
      id: "army_consequence_tired",
      cityId: ps.city.id,
      name: "Frayed Wall Watch",
      type: "militia",
      power: 90,
      size: 260,
      readiness: 36,
      upkeep: { wealth: 8, materials: 5 },
      specialties: ["defense", "recovery"],
      status: "idle",
    },
  ] as any;

  ps.currentOffers = [
    {
      id: "world_setback_test",
      kind: "army",
      difficulty: "high",
      title: "Break the Breach",
      description: "Hostiles have opened a breach in the outer district.",
      regionId: ps.city.regionId,
      recommendedPower: 165,
      expectedRewards: { materials: 40 },
      risk: { casualtyRisk: "severe" },
      responseTags: ["frontline", "command"],
      threatFamily: "organized_hostile_forces",
    },
  ] as any;

  const active = startMissionForPlayer(ps.playerId, "world_setback_test", now, undefined, "army_consequence_tired", "desperate");
  assert.ok(active);
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.9, 0.65], () => completeMissionForPlayer(ps.playerId, active!.instanceId, now));
  assert.equal(result.status, "ok");
  assert.equal(result.outcome?.kind, "failure");

  const entry = ps.worldConsequences[0];
  assert.ok(entry, "expected world consequence ledger entry");
  assert.equal(entry.source, "mission_setback");
  assert.equal(entry.outcome, "failure");
  assert.ok(entry.tags.includes("city_pressure_export"));
  assert.ok(entry.tags.includes("regional_instability"));
  assert.ok(entry.metrics.threatDelta > 0);
}
);

test("recovery contract outcomes export player and mother-brain readable consequence signals", () => {
  const ps = getOrCreatePlayerState("world_consequence_contract_player");
  const now = new Date("2026-03-18T20:30:00Z");

  ps.resources.wealth = 2000;
  ps.resources.materials = 2000;
  ps.resources.mana = 1200;
  ps.resources.unity = 100;
  ps.city.stats.unity = 46;
  ps.cityStress.recoveryBurden = 52;
  ps.cityStress.threatPressure = 48;
  ps.heroes = [
    {
      id: "hero_recover_good_ledger",
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

  const active = startMissionForPlayer(ps.playerId, contract!.id, now, "hero_recover_good_ledger", undefined, "balanced");
  assert.ok(active);
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.24, 0.14], () => completeMissionForPlayer(ps.playerId, active!.instanceId, now));
  assert.equal(result.status, "ok");

  const entry = ps.worldConsequences[0];
  assert.ok(entry, "expected recovery contract ledger entry");
  assert.equal(entry.source, "recovery_contract");
  assert.equal(entry.contractKind, contract!.contractKind);
  assert.ok(entry.audiences.includes("mother_brain"));

  const summary = summarizePlayerWorldConsequences(ps);
  assert.ok(summary.total >= 1);
  assert.ok(summary.countsBySource.recovery_contract >= 1);
  assert.ok(summary.note.length > 0);
});
