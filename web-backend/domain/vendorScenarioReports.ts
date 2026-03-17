//web-backend/domain/vendorScenarioReports.ts

import fs from "node:fs/promises";

const VALID_ACTIONS = new Set(["preview", "apply"]);
const VALID_LANES = new Set(["essentials", "comfort", "luxury", "arcane"]);
const VALID_BRIDGE_BANDS = new Set(["open", "strained", "restricted"]);
const VALID_VENDOR_STATES = new Set(["abundant", "stable", "pressured", "restricted"]);
const VALID_RUNTIME_STATES = new Set(["surplus", "normal", "tight", "scarce"]);

type VendorScenarioAction = "preview" | "apply";
type VendorScenarioLane = "essentials" | "comfort" | "luxury" | "arcane";
type VendorScenarioBridgeBand = "open" | "strained" | "restricted";
type VendorScenarioVendorState = "abundant" | "stable" | "pressured" | "restricted";
type VendorScenarioRuntimeState = "surplus" | "normal" | "tight" | "scarce";

export type VendorScenarioReportSampleItem = {
  vendorItemId: number;
  itemId: string;
  itemName: string | null;
  lane: VendorScenarioLane | null;
  runtimeState: VendorScenarioRuntimeState | null;
  allowed: boolean;
  applied: boolean;
  warnings: string[];
};

export type VendorScenarioReportEntry = {
  at: string;
  actor: "admin_ui";
  action: VendorScenarioAction;
  vendorId: string;
  selectionLabel: string;
  laneFilters: VendorScenarioLane[];
  presetKey: string | null;
  bridgeBand: VendorScenarioBridgeBand;
  vendorState: VendorScenarioVendorState;
  matchedCount: number;
  appliedCount: number;
  softenedCount: number;
  blockedCount: number;
  warningCount: number;
  note: string;
  selectionKind: "vendor_item_ids" | "lane_filters" | "preset" | "unknown";
  topWarnings: string[];
  sampleItems: VendorScenarioReportSampleItem[];
};

export type VendorScenarioReportFilter = {
  action?: VendorScenarioAction;
  presetKey?: string;
  lane?: VendorScenarioLane;
  laneSet?: string;
  bridgeBand?: VendorScenarioBridgeBand;
  vendorId?: string;
  vendorState?: VendorScenarioVendorState;
  before?: string;
  limit?: number;
};

export type VendorScenarioReportRollups = {
  matched: number;
  applied: number;
  softened: number;
  blocked: number;
  warnings: number;
  previews: number;
  applies: number;
};

export type VendorScenarioReviewBucket = {
  key: string;
  label: string;
  entryCount: number;
  matched: number;
  applied: number;
  softened: number;
  blocked: number;
  warnings: number;
  previews: number;
  applies: number;
  lastAt: string | null;
};

export type VendorScenarioReportReview = {
  reviewWindowSize: number;
  totalMatchingEntries: number;
  distinctVendors: number;
  distinctPresets: number;
  windowRollups: VendorScenarioReportRollups;
  byAction: VendorScenarioReviewBucket[];
  byPreset: VendorScenarioReviewBucket[];
  byLane: VendorScenarioReviewBucket[];
  byBridgeBand: VendorScenarioReviewBucket[];
  byVendorState: VendorScenarioReviewBucket[];
};

export type VendorScenarioReportResponse = {
  entries: VendorScenarioReportEntry[];
  rollups: VendorScenarioReportRollups;
  review: VendorScenarioReportReview;
  filtersApplied: {
    action: VendorScenarioAction | null;
    presetKey: string | null;
    lane: VendorScenarioLane | null;
    laneSet: string | null;
    bridgeBand: VendorScenarioBridgeBand | null;
    vendorId: string | null;
    vendorState: VendorScenarioVendorState | null;
    before: string | null;
    limit: number;
  };
  malformedCount: number;
  nextCursor: string | null;
};

function clampInt(value: number | undefined, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if ((value as number) < lo) return lo;
  if ((value as number) > hi) return hi;
  return Math.floor(value as number);
}

function asIsoString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function asCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeLane(value: unknown): VendorScenarioLane | null {
  const lane = asString(value);
  if (!lane || !VALID_LANES.has(lane)) return null;
  return lane as VendorScenarioLane;
}

function normalizeLaneList(value: unknown): VendorScenarioLane[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<VendorScenarioLane>();
  const lanes: VendorScenarioLane[] = [];
  for (const item of value) {
    const lane = normalizeLane(item);
    if (!lane || seen.has(lane)) continue;
    seen.add(lane);
    lanes.push(lane);
  }
  return lanes;
}

function normalizeWarningList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const warning = asString(item);
    if (!warning || seen.has(warning)) continue;
    seen.add(warning);
    warnings.push(warning);
  }
  return warnings;
}

function normalizeRuntimeState(value: unknown): VendorScenarioRuntimeState | null {
  const state = asString(value);
  if (!state || !VALID_RUNTIME_STATES.has(state)) return null;
  return state as VendorScenarioRuntimeState;
}

function normalizeSelectionKind(value: unknown): VendorScenarioReportEntry["selectionKind"] {
  const kind = asString(value);
  if (kind === "vendor_item_ids" || kind === "lane_filters" || kind === "preset") return kind;
  return "unknown";
}

function normalizeSampleItems(value: unknown): VendorScenarioReportSampleItem[] {
  if (!Array.isArray(value)) return [];
  const items: VendorScenarioReportSampleItem[] = [];
  for (const row of value.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const vendorItemId = Number((row as any).vendorItemId);
    if (!Number.isFinite(vendorItemId) || vendorItemId <= 0) continue;
    items.push({
      vendorItemId: Math.floor(vendorItemId),
      itemId: asString((row as any).itemId) ?? "",
      itemName: asString((row as any).itemName),
      lane: normalizeLane((row as any).lane),
      runtimeState: normalizeRuntimeState((row as any).runtimeState),
      allowed: Boolean((row as any).allowed),
      applied: Boolean((row as any).applied),
      warnings: normalizeWarningList((row as any).warnings),
    });
  }
  return items;
}

function laneSetKey(lanes: VendorScenarioLane[]): string {
  return [...lanes].sort((a, b) => a.localeCompare(b)).join(",");
}

export function normalizeVendorScenarioReportEntry(raw: unknown): VendorScenarioReportEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const at = asIsoString((raw as any).at);
  if (!at) return null;

  const action = asString((raw as any).action);
  const bridgeBand = asString((raw as any).bridgeBand);
  const vendorState = asString((raw as any).vendorState);
  const vendorId = asString((raw as any).vendorId);
  const selectionLabel = asString((raw as any).selectionLabel);
  const note = asString((raw as any).note);

  if (!action || !VALID_ACTIONS.has(action)) return null;
  if (!bridgeBand || !VALID_BRIDGE_BANDS.has(bridgeBand)) return null;
  if (!vendorState || !VALID_VENDOR_STATES.has(vendorState)) return null;
  if (!vendorId || !selectionLabel || !note) return null;

  const detail = ((raw as any).detail && typeof (raw as any).detail === "object") ? (raw as any).detail : null;

  return {
    at,
    actor: "admin_ui",
    action: action as VendorScenarioAction,
    vendorId,
    selectionLabel,
    laneFilters: normalizeLaneList((raw as any).laneFilters),
    presetKey: asString((raw as any).presetKey),
    bridgeBand: bridgeBand as VendorScenarioBridgeBand,
    vendorState: vendorState as VendorScenarioVendorState,
    matchedCount: asCount((raw as any).matchedCount),
    appliedCount: asCount((raw as any).appliedCount),
    softenedCount: asCount((raw as any).softenedCount),
    blockedCount: asCount((raw as any).blockedCount),
    warningCount: asCount((raw as any).warningCount),
    note,
    selectionKind: normalizeSelectionKind(detail?.selectionKind),
    topWarnings: normalizeWarningList(detail?.topWarnings),
    sampleItems: normalizeSampleItems(detail?.sampleItems),
  };
}

export function filterVendorScenarioReportEntries(
  entries: VendorScenarioReportEntry[],
  filter: VendorScenarioReportFilter,
): VendorScenarioReportEntry[] {
  const beforeMs = filter.before ? Date.parse(filter.before) : NaN;
  const expectedLaneSet = filter.laneSet
    ? laneSetKey(normalizeLaneList(String(filter.laneSet).split(",").map((lane) => lane.trim())))
    : null;
  return entries.filter((entry) => {
    if (filter.action && entry.action !== filter.action) return false;
    if (filter.presetKey && entry.presetKey !== filter.presetKey) return false;
    if (filter.lane && !entry.laneFilters.includes(filter.lane)) return false;
    if (expectedLaneSet !== null && laneSetKey(entry.laneFilters) !== expectedLaneSet) return false;
    if (filter.bridgeBand && entry.bridgeBand !== filter.bridgeBand) return false;
    if (filter.vendorId && entry.vendorId !== filter.vendorId) return false;
    if (filter.vendorState && entry.vendorState !== filter.vendorState) return false;
    if (Number.isFinite(beforeMs) && Date.parse(entry.at) >= beforeMs) return false;
    return true;
  });
}

function emptyRollups(): VendorScenarioReportRollups {
  return {
    matched: 0,
    applied: 0,
    softened: 0,
    blocked: 0,
    warnings: 0,
    previews: 0,
    applies: 0,
  };
}

function applyEntryToRollups(acc: VendorScenarioReportRollups, entry: VendorScenarioReportEntry): VendorScenarioReportRollups {
  acc.matched += entry.matchedCount;
  acc.applied += entry.appliedCount;
  acc.softened += entry.softenedCount;
  acc.blocked += entry.blockedCount;
  acc.warnings += entry.warningCount;
  if (entry.action === "preview") acc.previews += 1;
  if (entry.action === "apply") acc.applies += 1;
  return acc;
}

type BucketAccumulator = VendorScenarioReviewBucket & { _sortHint: number; _firstSeenOrder: number };

function buildBuckets(
  entries: VendorScenarioReportEntry[],
  classify: (entry: VendorScenarioReportEntry) => Array<{ key: string; label: string }>,
): VendorScenarioReviewBucket[] {
  const buckets = new Map<string, BucketAccumulator>();
  let firstSeenOrder = 0;
  for (const entry of entries) {
    const labels = classify(entry);
    for (const label of labels) {
      const existing = buckets.get(label.key) ?? {
        key: label.key,
        label: label.label,
        entryCount: 0,
        matched: 0,
        applied: 0,
        softened: 0,
        blocked: 0,
        warnings: 0,
        previews: 0,
        applies: 0,
        lastAt: null,
        _sortHint: Number.POSITIVE_INFINITY,
        _firstSeenOrder: firstSeenOrder++,
      };
      existing.entryCount += 1;
      applyEntryToRollups(existing, entry);
      if (existing.lastAt === null || Date.parse(entry.at) > Date.parse(existing.lastAt)) {
        existing.lastAt = entry.at;
      }
      existing._sortHint = Math.min(existing._sortHint, Date.parse(entry.at));
      buckets.set(label.key, existing);
    }
  }

  return [...buckets.values()]
    .sort((a, b) => {
      if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
      if (b.applied !== a.applied) return b.applied - a.applied;
      if (a._sortHint !== b._sortHint) return a._sortHint - b._sortHint;
      return a._firstSeenOrder - b._firstSeenOrder;
    })
    .map(({ _sortHint, _firstSeenOrder, ...bucket }) => bucket);
}

function buildVendorScenarioReportReview(
  filtered: VendorScenarioReportEntry[],
  limit: number,
): VendorScenarioReportReview {
  const reviewWindowSize = clampInt(Math.max(limit * 2, 20), 10, 100);
  const reviewEntries = filtered.slice(0, reviewWindowSize);
  const distinctVendors = new Set(reviewEntries.map((entry) => entry.vendorId)).size;
  const distinctPresets = new Set(reviewEntries.map((entry) => entry.presetKey).filter(Boolean)).size;
  return {
    reviewWindowSize,
    totalMatchingEntries: filtered.length,
    distinctVendors,
    distinctPresets,
    windowRollups: reviewEntries.reduce(applyEntryToRollups, emptyRollups()),
    byAction: buildBuckets(reviewEntries, (entry) => [{ key: entry.action, label: entry.action }]),
    byPreset: buildBuckets(reviewEntries, (entry) => [{ key: entry.presetKey ?? "none", label: entry.presetKey ?? "none" }]),
    byLane: buildBuckets(reviewEntries, (entry) => {
      const lanes = entry.laneFilters.length ? entry.laneFilters : [null];
      return lanes.map((lane) => ({ key: lane ?? "none", label: lane ?? "none" }));
    }),
    byBridgeBand: buildBuckets(reviewEntries, (entry) => [{ key: entry.bridgeBand, label: entry.bridgeBand }]),
    byVendorState: buildBuckets(reviewEntries, (entry) => [{ key: entry.vendorState, label: entry.vendorState }]),
  };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function renderVendorScenarioReportCsv(entries: VendorScenarioReportEntry[]): string {
  const headers = [
    "at",
    "action",
    "vendor_id",
    "selection_label",
    "lane_filters",
    "preset_key",
    "bridge_band",
    "vendor_state",
    "matched_count",
    "applied_count",
    "softened_count",
    "blocked_count",
    "warning_count",
    "selection_kind",
    "top_warnings",
    "sample_vendor_item_ids",
    "note",
  ];
  const lines = [headers.join(",")];
  for (const entry of entries) {
    lines.push([
      entry.at,
      entry.action,
      entry.vendorId,
      entry.selectionLabel,
      entry.laneFilters.join("|"),
      entry.presetKey ?? "",
      entry.bridgeBand,
      entry.vendorState,
      entry.matchedCount,
      entry.appliedCount,
      entry.softenedCount,
      entry.blockedCount,
      entry.warningCount,
      entry.selectionKind,
      entry.topWarnings.join(" | "),
      entry.sampleItems.map((item) => item.vendorItemId).join("|"),
      entry.note,
    ].map(csvEscape).join(","));
  }
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

export function buildVendorScenarioReportResponse(
  entries: VendorScenarioReportEntry[],
  filter: VendorScenarioReportFilter,
  malformedCount = 0,
): VendorScenarioReportResponse {
  const limit = clampInt(filter.limit, 1, 100);
  const filtered = filterVendorScenarioReportEntries(entries, filter);
  const page = filtered.slice(0, limit);
  const rollups = page.reduce<VendorScenarioReportRollups>(applyEntryToRollups, emptyRollups());

  return {
    entries: page,
    rollups,
    review: buildVendorScenarioReportReview(filtered, limit),
    filtersApplied: {
      action: filter.action ?? null,
      presetKey: filter.presetKey ?? null,
      lane: filter.lane ?? null,
      laneSet: filter.laneSet ? laneSetKey(normalizeLaneList(String(filter.laneSet).split(",").map((lane) => lane.trim()))) : null,
      bridgeBand: filter.bridgeBand ?? null,
      vendorId: filter.vendorId ?? null,
      vendorState: filter.vendorState ?? null,
      before: filter.before ?? null,
      limit,
    },
    malformedCount,
    nextCursor: filtered.length > limit ? page[page.length - 1]?.at ?? null : null,
  };
}

export async function readVendorScenarioReportFromFile(
  logPath: string,
  filter: VendorScenarioReportFilter,
): Promise<VendorScenarioReportResponse> {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const entries: VendorScenarioReportEntry[] = [];
    let malformedCount = 0;

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      try {
        const parsed = JSON.parse(line);
        const entry = normalizeVendorScenarioReportEntry(parsed);
        if (!entry) {
          malformedCount += 1;
          continue;
        }
        entries.push(entry);
      } catch {
        malformedCount += 1;
      }
    }

    return buildVendorScenarioReportResponse(entries, filter, malformedCount);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return buildVendorScenarioReportResponse([], filter, 0);
    }
    throw err;
  }
}
