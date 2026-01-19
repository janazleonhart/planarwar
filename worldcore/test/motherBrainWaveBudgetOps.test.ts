
// worldcore/test/motherBrainWaveBudgetOps.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { computeBrainWaveBudgetReport, filterPlannedActionsToBudget } from "../sim/MotherBrainWaveOps";

function mkSpawnId(epoch: number, theme: string, suffix: string): string {
  return `brain:${epoch}:${theme}:${suffix}`;
}

test("Mother Brain budgets compute allowedNewInserts correctly (append vs replace)", () => {
  const existing = [
    mkSpawnId(0, "goblins", "a"),
    mkSpawnId(0, "goblins", "b"),
    mkSpawnId(1, "goblins", "c"),
    mkSpawnId(0, "rats", "d"),
  ];

  const caps = {
    maxTotalInBounds: 5,
    maxThemeInBounds: 3,
    maxEpochThemeInBounds: 2,
    maxNewInserts: 10,
  };

  const appendReport = computeBrainWaveBudgetReport({
    existingBrainSpawnIdsInBox: existing,
    append: true,
    theme: "goblins",
    epoch: 0,
    budget: caps,
  });

  // existing total=4, theme(goblins)=3, epochTheme(0,goblins)=2
  // allowed by total = 1, by theme = 0, by epochTheme = 0 => allowedNewInserts = 0
  assert.equal(appendReport.observedExisting.total, 4);
  assert.equal(appendReport.observedExisting.theme, 3);
  assert.equal(appendReport.observedExisting.epochTheme, 2);
  assert.equal(appendReport.allowedNewInserts, 0);
  assert.ok(appendReport.limitingCaps.includes("maxThemeInBounds"));
  assert.ok(appendReport.limitingCaps.includes("maxEpochThemeInBounds"));

  const replaceReport = computeBrainWaveBudgetReport({
    existingBrainSpawnIdsInBox: existing,
    append: false,
    theme: "goblins",
    epoch: 0,
    budget: caps,
  });

  // replace-mode treats existing as 0 => allowed by epochTheme=2 is limiting
  assert.equal(replaceReport.allowedNewInserts, 2);
  assert.ok(replaceReport.limitingCaps.includes("maxEpochThemeInBounds"));
});

test("Budget filter trims inserts deterministically", () => {
  const planned = [
    { kind: "place_spawn", spawn: { spawnId: "brain:0:goblins:1" } },
    { kind: "place_spawn", spawn: { spawnId: "brain:0:goblins:2" } },
    { kind: "place_spawn", spawn: { spawnId: "brain:0:goblins:3" } },
    { kind: "place_spawn", spawn: { spawnId: "brain:0:goblins:4" } },
  ] as any[];

  const filtered = filterPlannedActionsToBudget({
    plannedActions: planned as any,
    existingSpawnIds: new Set<string>(),
    updateExisting: false,
    allowedNewInserts: 2,
  });

  assert.equal(filtered.keptInserts, 2);
  assert.equal(filtered.droppedDueToBudget, 2);
  assert.equal(filtered.filteredActions.length, 2);
});
