//web-backend/test/defenseResolutionSetbacks.test.ts

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

test("response posture and budget support change mission outcomes", () => {
  const ps = getOrCreatePlayerState("defense_posture_player");
  const now = new Date("2026-03-18T18:00:00Z");

  ps.resources.wealth = 800;
  ps.resources.materials = 800;
  ps.resources.mana = 300;
  ps.resources.unity = 200;
  ps.armies = [
    {
      id: "army_line",
      cityId: ps.city.id,
      name: "Shield Line",
      type: "line",
      power: 118,
      size: 340,
      readiness: 84,
      upkeep: { wealth: 10, materials: 7 },
      specialties: ["frontline", "command", "defense"],
      status: "idle",
    },
  ] as any;

  const missionBase = {
    kind: "army",
    difficulty: "high",
    title: "Hold the Eastern Gate",
    description: "A heavy probing strike is testing your gatehouse.",
    regionId: ps.city.regionId,
    recommendedPower: 140,
    expectedRewards: { materials: 35 },
    risk: { casualtyRisk: "high" },
    responseTags: ["frontline", "defense", "command"],
  } as const;

  ps.currentOffers = [{ id: "posture_cautious", ...missionBase } as any];
  const cautious = startMissionForPlayer(ps.playerId, "posture_cautious", now, undefined, "army_line", "cautious");
  assert.ok(cautious);
  cautious!.finishesAt = now.toISOString();
  const cautiousOutcome = withRandomSequence([0.6, 0.2], () =>
    completeMissionForPlayer(ps.playerId, cautious!.instanceId, now),
  );
  assert.equal(cautiousOutcome.status, "ok");
  assert.ok((cautiousOutcome.outcome?.successChance ?? 0) > 0);

  ps.armies[0]!.status = "idle" as any;
  delete (ps.armies[0] as any).currentMissionId;
  ps.armies[0]!.readiness = 84;

  ps.currentOffers = [{ id: "posture_desperate", ...missionBase } as any];
  const desperate = startMissionForPlayer(ps.playerId, "posture_desperate", now, undefined, "army_line", "desperate");
  assert.ok(desperate);
  desperate!.finishesAt = now.toISOString();
  const desperateOutcome = withRandomSequence([0.6, 0.2], () =>
    completeMissionForPlayer(ps.playerId, desperate!.instanceId, now),
  );
  assert.equal(desperateOutcome.status, "ok");
  assert.ok((desperateOutcome.outcome?.successChance ?? 0) > (cautiousOutcome.outcome?.successChance ?? 0), "desperate posture should trade for better odds on the same mission");
  assert.ok((desperateOutcome.outcome?.casualtyRate ?? 0) >= (cautiousOutcome.outcome?.casualtyRate ?? 0), "desperate posture should not be safer than cautious posture on the same roll path");
});

test("failed defense missions generate readable setback receipts", () => {
  const ps = getOrCreatePlayerState("defense_setback_player");
  const now = new Date("2026-03-18T19:00:00Z");

  ps.resources.wealth = 500;
  ps.resources.materials = 500;
  ps.resources.unity = 120;
  ps.city.stats.security = 58;
  ps.city.stats.stability = 57;
  ps.city.stats.unity = 60;
  ps.city.stats.infrastructure = 52;

  ps.armies = [
    {
      id: "army_tired",
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
      id: "setback_test",
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
  ];

  const active = startMissionForPlayer(ps.playerId, "setback_test", now, undefined, "army_tired", "desperate");
  assert.ok(active);
  active!.finishesAt = now.toISOString();

  const result = withRandomSequence([0.9, 0.65], () =>
    completeMissionForPlayer(ps.playerId, active!.instanceId, now),
  );
  assert.equal(result.status, "ok");
  assert.equal(result.outcome?.kind, "failure");
  assert.ok((result.receipt?.setbacks.length ?? 0) >= 3);
  assert.ok(result.receipt?.summary.includes("recorded setback"));
  assert.ok(ps.missionReceipts.length > 0);
  assert.ok(ps.city.stats.security < 58);
  assert.ok(ps.city.stats.infrastructure < 52);
}
);
