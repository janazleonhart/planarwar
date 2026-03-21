//web-backend/test/cityPolishPresentationHelpers.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  formatProductionDelta,
  getInfrastructureReceiptTone,
  summarizePublicInfrastructureReceipts,
  summarizeTreasury,
} from "../../web-frontend/components/city/cityPolishSummaries";
import {
  formatMissionDefenseOutcomeLabel,
  getMissionDefenseReceiptTone,
  summarizeMissionDefenseReceipts,
} from "../../web-frontend/components/worldResponse/worldResponsePolishSummaries";
import type { CityStressState, CitySummary, MissionDefenseReceipt, Resources } from "../../web-frontend/lib/apiTypes";

function makeResources(overrides: Partial<Resources> = {}): Resources {
  return {
    food: 10,
    materials: 20,
    wealth: 30,
    mana: 40,
    knowledge: 50,
    unity: 60,
    ...overrides,
  };
}

function makeStress(overrides: Partial<CityStressState> = {}): CityStressState {
  return {
    stage: "stable",
    total: 1,
    foodPressure: 0,
    threatPressure: 0,
    unityPressure: 0,
    recoveryBurden: 0,
    lastUpdatedAt: new Date("2026-03-19T12:00:00Z").toISOString(),
    ...overrides,
  };
}

function makeCity(): CitySummary {
  return {
    id: "city_1",
    name: "Asterfall",
    shardId: "shard_1",
    regionId: "starter_plains",
    settlementLane: "city",
    settlementLaneProfile: {
      id: "city",
      label: "City",
      summary: "Orderly civic administration with cleaner legitimacy and steadier support.",
      posture: "civic",
      strengths: ["stable services", "legitimate governance"],
      liabilities: ["slower illicit profit", "less shadow leverage"],
      responseFocus: {
        preferredActionLanes: ["economy", "regional", "faction", "observability", "cartel", "black_market"],
        advisoryTone: "stabilize supply lanes before scarcity hardens",
        recommendedOpening: "Favor recovery, logistics, and public order before chasing opportunistic shadow gains.",
      },
    },
    settlementLaneReceipt: {
      title: "Civic foundation established",
      summary: "The settlement opened as a lawful city with cleaner legitimacy and public order.",
      effects: ["No shadow surplus", "Service posture starts cleaner"],
    },
    settlementLaneLatestReceipt: {
      title: "Latest civic receipt",
      message: "Civic surplus kept the city steady (+5 food, +5 unity).",
      kind: "city_morph",
      timestamp: new Date("2026-03-19T12:05:00Z").toISOString(),
    },
    tier: 2,
    maxBuildingSlots: 8,
    stats: {
      population: 10,
      stability: 10,
      prosperity: 10,
      security: 10,
      infrastructure: 10,
      arcaneSaturation: 10,
      influence: 10,
      unity: 10,
    },
    buildings: [],
    specializationId: null,
    specializationStars: 0,
    specializationStarsHistory: {},
    buildingSlotsUsed: 2,
    buildingSlotsMax: 8,
    production: {
      foodPerTick: 4,
      materialsPerTick: -2,
      wealthPerTick: 0,
      manaPerTick: 5,
      knowledgePerTick: 1,
      unityPerTick: 3,
    },
    productionBreakdown: {
      buildings: {
        foodPerTick: 4,
        materialsPerTick: -2,
        wealthPerTick: 0,
        manaPerTick: 5,
        knowledgePerTick: 1,
        unityPerTick: 3,
      },
      settlementLane: {
        foodPerTick: 0,
        materialsPerTick: 0,
        wealthPerTick: 0,
        manaPerTick: 0,
        knowledgePerTick: 0,
        unityPerTick: 0,
      },
    },
  };
}

function makeReceipt(overrides: Partial<MissionDefenseReceipt> = {}): MissionDefenseReceipt {
  return {
    id: "receipt_1",
    missionId: "mission_1",
    missionTitle: "Defend the caravan",
    createdAt: new Date("2026-03-19T12:00:00Z").toISOString(),
    outcome: "success",
    posture: "balanced",
    summary: "Everything stayed mostly attached.",
    setbacks: [],
    ...overrides,
  };
}

test("city polish helpers summarize treasury by stress band", () => {
  const calm = summarizeTreasury(makeResources(), makeStress({ stage: "stable", total: 1, recoveryBurden: 0 }));
  const strained = summarizeTreasury(makeResources(), makeStress({ stage: "strained", total: 5, recoveryBurden: 2 }));
  const crisis = summarizeTreasury(makeResources(), makeStress({ stage: "crisis", total: 9, recoveryBurden: 4 }));

  assert.equal(calm.headline, "Stores look stable");
  assert.match(calm.detail, /Combined stores 210/);
  assert.equal(strained.headline, "Resources are serviceable");
  assert.equal(crisis.headline, "Treasury under pressure");
});

test("city polish helpers format production deltas and infrastructure strain thresholds", () => {
  const city = makeCity();

  assert.equal(formatProductionDelta(city, "food"), "+4/tick");
  assert.equal(formatProductionDelta(city, "materials"), "-2/tick");
  assert.equal(formatProductionDelta(city, "wealth"), "+0/tick");
  assert.equal(formatProductionDelta(null, "wealth"), "no city production yet");

  assert.equal(getInfrastructureReceiptTone(2), "calm");
  assert.equal(getInfrastructureReceiptTone(5), "watch");
  assert.equal(getInfrastructureReceiptTone(8), "danger");
});

test("city polish helpers summarize public infrastructure receipts", () => {
  const summary = summarizePublicInfrastructureReceipts([
    { queueMinutes: 10, strainScore: 3 },
    { queueMinutes: 25, strainScore: 7 },
    { queueMinutes: 40, strainScore: 9 },
  ]);

  assert.equal(summary.queueAverage, 25);
  assert.equal(summary.highestStrain, 9);
  assert.equal(summary.latest?.strainScore, 3);
});

test("world response polish helpers summarize defense receipts and tone outcomes", () => {
  const receipts = [
    makeReceipt({
      id: "r1",
      outcome: "partial",
      posture: "cautious",
      setbacks: [{ kind: "unrest", severity: 1, summary: "Shaken", detail: "A few civilians panicked." }],
    }),
    makeReceipt({ id: "r2", outcome: "failure", posture: "desperate" }),
  ];

  const summary = summarizeMissionDefenseReceipts(receipts);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.setbackCount, 1);
  assert.equal(summary.latestPosture, "cautious");

  assert.equal(getMissionDefenseReceiptTone(makeReceipt()), "calm");
  assert.equal(getMissionDefenseReceiptTone(receipts[0]), "watch");
  assert.equal(getMissionDefenseReceiptTone(receipts[1]), "danger");
  assert.equal(formatMissionDefenseOutcomeLabel("partial"), "Partial");
});
