//web-backend/test/vendorScenarioReports.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVendorScenarioReportResponse,
  filterVendorScenarioReportEntries,
  normalizeVendorScenarioReportEntry,
  renderVendorScenarioReportCsv,
} from "../domain/vendorScenarioReports";

test("normalizeVendorScenarioReportEntry upgrades detailed scenario rows", () => {
  const entry = normalizeVendorScenarioReportEntry({
    at: "2026-03-17T14:00:00.000Z",
    actor: "admin_ui",
    action: "apply",
    vendorId: "vendor_blacksmith",
    selectionLabel: "Luxury throttle",
    laneFilters: ["luxury", "luxury", "comfort"],
    presetKey: "luxury_throttle",
    bridgeBand: "strained",
    vendorState: "pressured",
    matchedCount: 6,
    appliedCount: 4,
    softenedCount: 2,
    blockedCount: 1,
    warningCount: 3,
    note: "Applied guarded runtime.",
    detail: {
      selectionKind: "preset",
      topWarnings: ["cap softened", "cadence clamped"],
      sampleItems: [
        {
          vendorItemId: 77,
          itemId: "silk_robe",
          itemName: "Silk Robe",
          lane: "luxury",
          runtimeState: "tight",
          allowed: true,
          applied: true,
          warnings: ["cap softened"],
        },
      ],
    },
  });

  assert.ok(entry);
  assert.equal(entry?.selectionKind, "preset");
  assert.deepEqual(entry?.laneFilters, ["luxury", "comfort"]);
  assert.equal(entry?.sampleItems[0]?.vendorItemId, 77);
  assert.equal(entry?.sampleItems[0]?.lane, "luxury");
});

test("filterVendorScenarioReportEntries filters by lane, action, vendor, and before cursor", () => {
  const entries = [
    normalizeVendorScenarioReportEntry({
      at: "2026-03-17T14:02:00.000Z",
      actor: "admin_ui",
      action: "preview",
      vendorId: "vendor_arcane",
      selectionLabel: "Arcane caution",
      laneFilters: ["arcane"],
      presetKey: "arcane_caution",
      bridgeBand: "restricted",
      vendorState: "restricted",
      matchedCount: 3,
      appliedCount: 0,
      softenedCount: 1,
      blockedCount: 1,
      warningCount: 2,
      note: "Previewed guarded runtime.",
    }),
    normalizeVendorScenarioReportEntry({
      at: "2026-03-17T13:55:00.000Z",
      actor: "admin_ui",
      action: "apply",
      vendorId: "vendor_blacksmith",
      selectionLabel: "Luxury throttle",
      laneFilters: ["luxury"],
      presetKey: "luxury_throttle",
      bridgeBand: "strained",
      vendorState: "pressured",
      matchedCount: 6,
      appliedCount: 4,
      softenedCount: 2,
      blockedCount: 1,
      warningCount: 3,
      note: "Applied guarded runtime.",
    }),
    normalizeVendorScenarioReportEntry({
      at: "2026-03-17T13:40:00.000Z",
      actor: "admin_ui",
      action: "apply",
      vendorId: "vendor_blacksmith",
      selectionLabel: "Essentials lane",
      laneFilters: ["essentials"],
      presetKey: null,
      bridgeBand: "open",
      vendorState: "stable",
      matchedCount: 5,
      appliedCount: 5,
      softenedCount: 0,
      blockedCount: 0,
      warningCount: 0,
      note: "Applied guarded runtime.",
    }),
  ].filter(Boolean);

  const filtered = filterVendorScenarioReportEntries(entries as any, {
    action: "apply",
    lane: "luxury",
    vendorId: "vendor_blacksmith",
    before: "2026-03-17T14:00:00.000Z",
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.presetKey, "luxury_throttle");
});

test("buildVendorScenarioReportResponse aggregates rollups and tolerates malformed history gaps", () => {
  const entries = [
    normalizeVendorScenarioReportEntry({
      at: "2026-03-17T14:02:00.000Z",
      actor: "admin_ui",
      action: "preview",
      vendorId: "vendor_arcane",
      selectionLabel: "Arcane caution",
      laneFilters: ["arcane"],
      presetKey: "arcane_caution",
      bridgeBand: "restricted",
      vendorState: "restricted",
      matchedCount: 3,
      appliedCount: 0,
      softenedCount: 1,
      blockedCount: 1,
      warningCount: 2,
      note: "Previewed guarded runtime.",
    }),
    normalizeVendorScenarioReportEntry({
      at: "2026-03-17T13:55:00.000Z",
      actor: "admin_ui",
      action: "apply",
      vendorId: "vendor_blacksmith",
      selectionLabel: "Luxury throttle",
      laneFilters: ["luxury"],
      presetKey: "luxury_throttle",
      bridgeBand: "strained",
      vendorState: "pressured",
      matchedCount: 6,
      appliedCount: 4,
      softenedCount: 2,
      blockedCount: 1,
      warningCount: 3,
      note: "Applied guarded runtime.",
    }),
    null,
  ].filter(Boolean) as any[];

  const response = buildVendorScenarioReportResponse(entries, { limit: 2 }, 1);

  assert.equal(response.entries.length, 2);
  assert.deepEqual(response.rollups, {
    matched: 9,
    applied: 4,
    softened: 3,
    blocked: 2,
    warnings: 5,
    previews: 1,
    applies: 1,
  });
  assert.equal(response.malformedCount, 1);
  assert.equal(response.nextCursor, null);
});


test("buildVendorScenarioReportResponse includes grouped review buckets for the review window", () => {
  const entries = [
    normalizeVendorScenarioReportEntry({
      at: "2026-03-17T14:10:00.000Z",
      actor: "admin_ui",
      action: "apply",
      vendorId: "vendor_blacksmith",
      selectionLabel: "Luxury throttle",
      laneFilters: ["luxury", "comfort"],
      presetKey: "luxury_throttle",
      bridgeBand: "strained",
      vendorState: "pressured",
      matchedCount: 7,
      appliedCount: 5,
      softenedCount: 1,
      blockedCount: 1,
      warningCount: 2,
      note: "Applied guarded runtime.",
    }),
    normalizeVendorScenarioReportEntry({
      at: "2026-03-17T14:08:00.000Z",
      actor: "admin_ui",
      action: "preview",
      vendorId: "vendor_blacksmith",
      selectionLabel: "Essentials protection",
      laneFilters: ["essentials"],
      presetKey: "scarcity_essentials_protection",
      bridgeBand: "restricted",
      vendorState: "pressured",
      matchedCount: 4,
      appliedCount: 0,
      softenedCount: 2,
      blockedCount: 1,
      warningCount: 3,
      note: "Previewed guarded runtime.",
    }),
    normalizeVendorScenarioReportEntry({
      at: "2026-03-17T14:05:00.000Z",
      actor: "admin_ui",
      action: "apply",
      vendorId: "vendor_arcane",
      selectionLabel: "Arcane caution",
      laneFilters: ["arcane"],
      presetKey: "arcane_caution",
      bridgeBand: "restricted",
      vendorState: "restricted",
      matchedCount: 3,
      appliedCount: 2,
      softenedCount: 1,
      blockedCount: 0,
      warningCount: 1,
      note: "Applied guarded runtime.",
    }),
  ].filter(Boolean) as any[];

  const response = buildVendorScenarioReportResponse(entries, { limit: 2 }, 0);
  assert.equal(response.review.totalMatchingEntries, 3);
  assert.equal(response.review.distinctVendors, 2);
  assert.equal(response.review.distinctPresets, 3);
  assert.equal(response.review.byLane[0]?.label, "luxury");
  assert.ok(response.review.byPreset.some((bucket) => bucket.label === "arcane_caution"));
  assert.equal(response.review.byBridgeBand[0]?.label, "restricted");
  assert.equal(response.review.windowRollups.previews, 1);
});

test("renderVendorScenarioReportCsv renders export rows with escaped values", () => {
  const entry = normalizeVendorScenarioReportEntry({
    at: "2026-03-17T14:10:00.000Z",
    actor: "admin_ui",
    action: "apply",
    vendorId: "vendor_blacksmith",
    selectionLabel: "Luxury throttle",
    laneFilters: ["luxury"],
    presetKey: "luxury_throttle",
    bridgeBand: "strained",
    vendorState: "pressured",
    matchedCount: 7,
    appliedCount: 5,
    softenedCount: 1,
    blockedCount: 1,
    warningCount: 2,
    note: 'Applied guarded runtime, operator said "proceed".',
    detail: {
      selectionKind: "preset",
      topWarnings: ["cap softened"],
      sampleItems: [{ vendorItemId: 22, itemId: "silk_robe", itemName: "Silk Robe", lane: "luxury", runtimeState: "tight", allowed: true, applied: true, warnings: [] }],
    },
  });
  const csv = renderVendorScenarioReportCsv([entry!]);
  assert.match(csv, /^﻿at,action,/);
  assert.match(csv, /vendor_blacksmith/);
  assert.match(csv, /"Applied guarded runtime, operator said ""proceed""\."/);
  assert.match(csv, /22/);
});
