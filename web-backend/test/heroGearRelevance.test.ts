//web-backend/test/heroGearRelevance.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  completeMissionForPlayer,
  equipHeroAttachmentForPlayer,
  getOrCreatePlayerState,
  startMissionForPlayer,
} from "../gameState";
import type { MissionOffer } from "../domain/missions";

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

test("hero gear slots and tags change outcome for matching city response lanes", () => {
  const ps = getOrCreatePlayerState("hero_gear_player");
  const now = new Date("2026-03-18T12:00:00Z");

  ps.resources.wealth = 1000;
  ps.resources.mana = 1000;
  ps.heroes = [
    {
      id: "hero_mage",
      ownerId: ps.playerId,
      name: "Meriel",
      role: "mage",
      responseRoles: ["warding", "command"],
      traits: [],
      power: 62,
      tags: [],
      status: "idle",
      attachments: [],
    },
  ] as any;

  const missionBase: MissionOffer = {
    id: "warding_test",
    kind: "hero",
    difficulty: "high",
    title: "Seal a Planar Breach",
    description: "An unstable breach is shedding hostile energy into the city approaches.",
    regionId: ps.city.regionId,
    recommendedPower: 100,
    expectedRewards: { knowledge: 40, wealth: 25 },
    risk: { casualtyRisk: "high", heroInjuryRisk: "moderate" },
    responseTags: ["warding", "command"],
  };

  ps.currentOffers = [{ ...missionBase }];
  const activeUnguided = startMissionForPlayer(ps.playerId, missionBase.id, now, "hero_mage");
  assert.ok(activeUnguided);
  activeUnguided!.finishesAt = now.toISOString();

  const plainOutcome = withRandomSequence([0.33, 0.4], () =>
    completeMissionForPlayer(ps.playerId, activeUnguided!.instanceId, now),
  );
  assert.equal(plainOutcome.status, "ok");
  assert.equal(plainOutcome.outcome?.kind, "partial");

  ps.heroes[0]!.status = "idle" as any;
  delete (ps.heroes[0] as any).currentMissionId;

  const gearResult = equipHeroAttachmentForPlayer(ps.playerId, "hero_mage", "arcane_focus", now);
  assert.equal(gearResult.status, "ok");
  assert.equal(gearResult.hero?.attachments?.[0]?.slot, "focus");
  assert.deepEqual(gearResult.hero?.attachments?.[0]?.responseTags, ["warding", "command"]);

  ps.currentOffers = [{ ...missionBase, id: "warding_test_retry" }];
  const activeGeared = startMissionForPlayer(ps.playerId, "warding_test_retry", now, "hero_mage");
  assert.ok(activeGeared);
  activeGeared!.finishesAt = now.toISOString();

  const gearedOutcome = withRandomSequence([0.33, 0.4], () =>
    completeMissionForPlayer(ps.playerId, activeGeared!.instanceId, now),
  );
  assert.equal(gearedOutcome.status, "ok");
  assert.equal(gearedOutcome.outcome?.kind, "success");
});
