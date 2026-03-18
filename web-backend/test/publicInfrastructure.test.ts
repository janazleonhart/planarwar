//web-backend/test/publicInfrastructure.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialPublicInfrastructureState,
  derivePublicPressureSources,
  quotePublicServiceUsage,
  summarizePublicInfrastructure,
} from "../domain/publicInfrastructure";
import { getOrCreatePlayerState } from "../gameState";
import { applyPublicInfrastructureUsage, withInfrastructureRollback } from "../routes/publicInfrastructureSupport";

function makePlayer() {
  const ps = getOrCreatePlayerState(`pubinfra_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  ps.publicInfrastructure = createInitialPublicInfrastructureState("2026-03-16T00:00:00.000Z");
  return ps;
}

test("npc public infrastructure quote applies novice subsidy and pressure sourcing", () => {
  const ps = makePlayer();
  ps.cityStress.stage = "strained";
  ps.cityStress.total = 42;
  const quote = quotePublicServiceUsage(
    ps,
    "workshop_craft",
    { materials: 80, wealth: 24, mana: 10 },
    "npc_public"
  );

  assert.equal(quote.mode, "npc_public");
  assert.equal(quote.permitTier, "novice");
  assert.ok((quote.levy.materials ?? 0) > 0);
  assert.ok((quote.levy.wealth ?? 0) > 0);
  assert.ok(quote.queueMinutes >= 8);
  assert.match(quote.note, /Novice civic subsidy/i);
  assert.ok(quote.pressureSources.some((source) => source.key === "civic_instability" && source.score > 0));
});

test("public infrastructure summary recommends private mode under severe pressure", () => {
  const ps = makePlayer();
  ps.cityStress.stage = "lockdown";
  ps.cityStress.total = 88;
  ps.publicInfrastructure.serviceHeat = 74;
  ps.workshopJobs.push({
    id: "job_a",
    attachmentKind: "valor_charm",
    startedAt: "2026-03-16T00:00:00.000Z",
    finishesAt: "2026-03-16T01:00:00.000Z",
    completed: false,
  });
  ps.workshopJobs.push({
    id: "job_b",
    attachmentKind: "arcane_focus",
    startedAt: "2026-03-16T00:10:00.000Z",
    finishesAt: "2026-03-16T01:10:00.000Z",
    completed: false,
  });
  ps.activeMissions.push({
    instanceId: "mission_a",
    startedAt: "2026-03-16T00:00:00.000Z",
    finishesAt: "2026-03-16T02:00:00.000Z",
    mission: {
      id: "mission_a",
      kind: "army",
      difficulty: "high",
      title: "Assault",
      description: "Test",
      regionId: "ancient_elwynn",
      recommendedPower: 100,
      expectedRewards: { materials: 10 },
      risk: { casualtyRisk: "Severe" },
      responseTags: ["frontline", "command"],
    },
    responsePosture: "balanced",
  });

  const summary = summarizePublicInfrastructure(ps);
  assert.equal(summary.strainBand, "critical");
  assert.equal(summary.recommendedMode, "private_city");
  assert.match(summary.note, /buckling under pressure/i);
  assert.ok(summary.primaryPressure);
  assert.ok(summary.pressureSources.length >= 3);
  assert.equal(summary.pressureScore >= summary.primaryPressure!.score, true);
});

test("pressure sources detect regional threat and mission load", () => {
  const ps = makePlayer();
  ps.regionWar[0].threat = 80;
  ps.regionWar[1].threat = 55;
  ps.activeMissions.push({
    instanceId: "mission_b",
    startedAt: "2026-03-16T00:00:00.000Z",
    finishesAt: "2026-03-16T02:00:00.000Z",
    assignedArmyId: ps.armies[0]?.id,
    mission: {
      id: "mission_b",
      kind: "army",
      difficulty: "medium",
      title: "Push",
      description: "Test",
      regionId: "ancient_elwynn",
      recommendedPower: 80,
      expectedRewards: { wealth: 12 },
      risk: { casualtyRisk: "Moderate" },
      responseTags: ["frontline", "command"],
    },
    responsePosture: "balanced",
  });
  if (ps.armies[0]) ps.armies[0].status = "on_mission";

  const sources = derivePublicPressureSources(ps);
  const regionalThreat = sources.find((source) => source.key === "regional_threat");
  const missionLoad = sources.find((source) => source.key === "mission_load");
  assert.ok(regionalThreat && regionalThreat.score > 0);
  assert.ok(missionLoad && missionLoad.score > 0);
});

test("applying npc public service usage returns receipt and pressure-aware event metadata", () => {
  const ps = makePlayer();
  ps.cityStress.stage = "crisis";
  ps.cityStress.total = 61;
  ps.regionWar[0].threat = 72;
  const beforeWealth = ps.resources.wealth;

  const result = applyPublicInfrastructureUsage(
    ps,
    "hero_recruit",
    "npc_public",
    { wealth: 40, materials: 12 },
    new Date("2026-03-16T00:30:00.000Z")
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.usage.receipt);
  assert.ok(result.usage.queueAppliedMinutes >= 10);
  assert.ok(ps.resources.wealth < beforeWealth);
  assert.match(result.usage.eventMessage, /Pressure inputs:/i);
  assert.equal(ps.publicInfrastructure.receipts.length, 1);
});

test("public infrastructure rollback restores player state when levy validation fails", () => {
  const ps = makePlayer();
  ps.resources.wealth = 10;
  const beforeWealth = ps.resources.wealth;
  const beforeHeroCount = ps.heroes.length;

  const wrapped = withInfrastructureRollback(
    ps,
    () => {
      ps.resources.wealth = 0;
      ps.heroes.push({
        id: "hero_test",
        ownerId: ps.playerId,
        name: "Test Hero",
        role: "champion",
        responseRoles: ["frontline"],
        traits: [],
        power: 99,
        tags: [],
        status: "idle",
      });
      return { ok: true };
    },
    () => ({ ok: false as const, error: "levy blocked" })
  );

  assert.equal(wrapped.ok, false);
  assert.equal(ps.resources.wealth, beforeWealth);
  assert.equal(ps.heroes.length, beforeHeroCount);
});
