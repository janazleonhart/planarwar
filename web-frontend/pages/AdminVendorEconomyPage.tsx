// web-frontend/pages/AdminVendorEconomyPage.tsx
//
// Admin editor for vendor_item_economy knobs (stock/restock/price multipliers).
// Polished UX: dirty tracking, bulk save, filters, and same-origin API via lib/api.ts.

import { useEffect, useMemo, useState } from "react";
import { api, buildVendorScenarioReportExportUrl, fetchCityMudBridgeStatus, fetchVendorScenarioReports, getAdminCaps, getAuthToken, type CityMudBridgeStatusResponse, type CityMudVendorSupportPolicy, type VendorScenarioAction, type VendorScenarioPolicyMode, type VendorScenarioReportEntry, type VendorScenarioReportResponse, type VendorScenarioResponsePhase } from "../lib/api";
import { ItemPicker } from "../components/ItemPicker";
import { AdminShell } from "../components/admin/AdminUI";

type VendorSummary = {
  id: string;
  name: string | null;
};

type VendorEconomyRecommendation = {
  stockMax: number;
  restockEverySec: number;
  restockAmount: number;
  priceMinMult: number;
  priceMaxMult: number;
  restockPerHour: number;
  headline: string;
  detail: string;
};

type VendorRuntimeEffect = {
  state: "surplus" | "normal" | "tight" | "scarce";
  effectiveStockMax: number;
  effectiveRestockEverySec: number;
  effectiveRestockAmount: number;
  effectivePriceMinMult: number;
  effectivePriceMaxMult: number;
  effectiveRestockPerHour: number;
  stockFillRatio: number | null;
  headline: string;
  detail: string;
};

type VendorLane = "essentials" | "comfort" | "luxury" | "arcane";
type VendorPresetKey = "scarcity_essentials_protection" | "luxury_throttle" | "arcane_caution" | "broad_recovery";

const ALL_VENDOR_LANES: VendorLane[] = ["essentials", "comfort", "luxury", "arcane"];
const VENDOR_PRESETS: Array<{ key: VendorPresetKey; label: string; detail: string; laneFilters: VendorLane[] }> = [
  { key: "scarcity_essentials_protection", label: "Scarcity essentials protection", detail: "Protect essentials first during scarcity.", laneFilters: ["essentials"] },
  { key: "luxury_throttle", label: "Luxury throttle", detail: "Throttle luxury stock before protected lanes.", laneFilters: ["luxury"] },
  { key: "arcane_caution", label: "Arcane caution", detail: "Apply guarded caution to arcane lanes.", laneFilters: ["arcane"] },
  { key: "broad_recovery", label: "Broad recovery", detail: "Run a broad guarded pass across all lanes.", laneFilters: [...ALL_VENDOR_LANES] },
];

type VendorLanePolicy = {
  lane: VendorLane;
  laneLabel: string;
  laneDetail: string;
  state: "abundant" | "stable" | "pressured" | "restricted";
  stockPosture: "expand" | "maintain" | "throttle" | "restrict";
  pricePosture: "discount" | "baseline" | "caution" | "surge_guard";
  cadencePosture: "accelerate" | "normal" | "slow" | "triage";
  recommendedStockMultiplier: number;
  recommendedPriceMinMultiplier: number;
  recommendedPriceMaxMultiplier: number;
  recommendedRestockCadenceMultiplier: number;
  headline: string;
  detail: string;
  recommendedAction: string;
};

type VendorEconomyItem = {
  vendor_item_id: number;
  vendor_id: string;
  vendor_name: string | null;
  item_id: string;
  item_name: string | null;
  item_rarity: string | null;
  base_price_gold: number;

  stock: number | null;
  stock_max: number | null;
  last_restock_ts: string | null;

  restock_per_hour: number | null;
  restock_every_sec: number | null;
  restock_amount: number | null;
  price_min_mult: number | null;
  price_max_mult: number | null;
  bridge_lane_policy?: VendorLanePolicy | null;
  bridge_recommendation?: VendorEconomyRecommendation | null;
  bridge_runtime_effect?: VendorRuntimeEffect | null;
};

type VendorRuntimeSummary = {
  policyMode: "bridge_only" | "consequence_aware";
  responsePhase: "quiet" | "watch" | "active" | "severe";
  vendorState: "abundant" | "stable" | "pressured" | "restricted";
  laneBias: "none" | "essentials_only" | "luxury_throttle" | "arcane_caution";
  runtimeStateCounts: Record<string, number>;
  laneCounts: Record<string, number>;
  recommendedPreset?: { key: VendorPresetKey; label: string; laneFilters: VendorLane[]; reason: string; note: string } | null;
  note: string;
};

type ItemsResponse = {
  ok: boolean;
  vendorId: string;
  total: number;
  limit: number;
  offset: number;
  items: VendorEconomyItem[];
  vendorPolicy?: CityMudVendorSupportPolicy | null;
  vendorRuntimeSummary?: VendorRuntimeSummary | null;
  error?: string;
};

type UpdateResponse = {
  ok: boolean;
  vendorItemId: number;
  applied?: {
    stockMax: number;
    restockEverySec: number;
    restockAmount: number;
    priceMinMult: number;
    priceMaxMult: number;
    restockPerHour: number;
    resetStock: boolean;
  };
  error?: string;
};

type GuardrailApplication = {
  allowed: boolean;
  autoApplyEligible: boolean;
  stockMax: number;
  restockEverySec: number;
  restockAmount: number;
  priceMinMult: number;
  priceMaxMult: number;
  restockPerHour: number;
  warnings: string[];
  reason: string;
  headline: string;
  detail: string;
};

type GuardedApplyResponse = {
  ok: boolean;
  vendorId: string;
  apply: boolean;
  resetStock: boolean;
  requestedCount: number;
  matchedCount: number;
  appliedCount: number;
  laneFiltersApplied?: VendorLane[];
  selectionLabel?: string;
  presetApplied?: { key: VendorPresetKey; label: string; detail: string; laneFilters: VendorLane[]; recommendedAction: string } | null;
  results: Array<{
    vendor_item_id: number;
    item_id: string;
    item_name: string | null;
    runtimeEffect: VendorRuntimeEffect;
    guardrail: GuardrailApplication;
    applied: boolean;
  }>;
  error?: string;
};


type EditRow = {
  stockMax: string;
  restockEverySec: string;
  restockAmount: string;
  priceMinMult: string;
  priceMaxMult: string;
  resetStock: boolean;
};

function numStr(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function clampStrNum(s: string): string {
  // Keep raw user input; just normalize whitespace.
  return String(s ?? "").trim();
}

function parseOptionalNumber(s: string): number | null {
  const t = clampStrNum(s);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function baselineForRow(r: VendorEconomyItem): Omit<EditRow, "resetStock"> {
  // IMPORTANT: Admin endpoint defaults to these values when omitted/invalid.
  // Baseline mirrors what the UI *suggests* as “default safe settings”.
  return {
    stockMax: numStr(r.stock_max ?? 50),
    restockEverySec: numStr(r.restock_every_sec ?? 0),
    restockAmount: numStr(r.restock_amount ?? 0),
    priceMinMult: numStr(r.price_min_mult ?? 0.85),
    priceMaxMult: numStr(r.price_max_mult ?? 1.5),
  };
}

function recommendationToEdit(rec: VendorEconomyRecommendation): Omit<EditRow, "resetStock"> {
  return {
    stockMax: String(rec.stockMax),
    restockEverySec: String(rec.restockEverySec),
    restockAmount: String(rec.restockAmount),
    priceMinMult: String(rec.priceMinMult),
    priceMaxMult: String(rec.priceMaxMult),
  };
}

function runtimeEffectToEdit(effect: VendorRuntimeEffect): Omit<EditRow, "resetStock"> {
  return {
    stockMax: String(effect.effectiveStockMax),
    restockEverySec: String(effect.effectiveRestockEverySec),
    restockAmount: String(effect.effectiveRestockAmount),
    priceMinMult: String(effect.effectivePriceMinMult),
    priceMaxMult: String(effect.effectivePriceMaxMult),
  };
}

function isFiniteStockMax(stockMax: number | null): boolean {
  return stockMax != null && stockMax > 0;
}

function isRestocking(everySec: number | null, amount: number | null): boolean {
  return (everySec ?? 0) > 0 && (amount ?? 0) > 0;
}

function parseIsoMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;

  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (hh > 0) return `${hh}:${pad2(mm)}:${pad2(ss)}`;
  return `${mm}:${pad2(ss)}`;
}

function getNextRestockLabel(
  r: VendorEconomyItem,
  nowMs: number
): { line: string; title?: string } | null {
  // Only meaningful for finite + cadence-enabled items.
  if (!isFiniteStockMax(r.stock_max ?? null)) return null;
  if (!isRestocking(r.restock_every_sec ?? null, r.restock_amount ?? null)) return null;

  const lastMs = parseIsoMs(r.last_restock_ts);
  const everySec = Number(r.restock_every_sec ?? 0);

  if (!lastMs || !Number.isFinite(everySec) || everySec <= 0) {
    return { line: "next: ?", title: "Missing/invalid last_restock_ts or restock_every_sec" };
  }

  const nextMs = lastMs + everySec * 1000;
  const nextIso = new Date(nextMs).toISOString();
  const nextLocal = new Date(nextMs).toLocaleString();

  const full =
    r.stock != null && r.stock_max != null && r.stock_max > 0 && Number(r.stock) >= Number(r.stock_max);

  // Polish: "DUE (full)" reads like an error state.
  // If stock is already capped, we show "full" and keep the exact tick timing in the tooltip.
  if (full) {
    const when = nowMs >= nextMs ? "next tick is due" : `next tick in ${formatHms(Math.ceil((nextMs - nowMs) / 1000))}`;
    return { line: "full", title: `Stock is at cap; ${when}. Next tick at ${nextLocal} (${nextIso})` };
  }

  if (nowMs >= nextMs) {
    return { line: "next: DUE", title: `next at ${nextLocal} (${nextIso})` };
  }

  const remainingSec = Math.ceil((nextMs - nowMs) / 1000);
  return {
    line: `next: ${formatHms(remainingSec)}`,
    title: `next at ${nextLocal} (${nextIso})`,
  };
}

function formatStockLabel(stock: number | null, stockMax: number | null): string {
  // Treat <=0 as infinite-ish (server uses 0 to represent “infinite / disabled”).
  const infinite = stock == null || stockMax == null || stockMax <= 0;
  if (infinite) return "∞";
  return `${stock}/${stockMax}`;
}


const authedFetch: typeof fetch = (input: any, init?: any) => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...(init ?? {}), headers });
};

export function AdminVendorEconomyPage() {
  const { canWrite } = getAdminCaps();
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [vendorId, setVendorId] = useState<string>("");

  const [items, setItems] = useState<VendorEconomyItem[]>([]);
  const [edits, setEdits] = useState<Record<number, EditRow>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<CityMudBridgeStatusResponse | null>(null);
  const [vendorPolicy, setVendorPolicy] = useState<CityMudVendorSupportPolicy | null>(null);
  const [vendorRuntimeSummary, setVendorRuntimeSummary] = useState<VendorRuntimeSummary | null>(null);

  const [nowMs, setNowMs] = useState(() => Date.now());

  const [limit, setLimit] = useState(500);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // UX polish controls
  const [qItem, setQItem] = useState("");
  const [onlyFinite, setOnlyFinite] = useState(false);
  const [onlyRestock, setOnlyRestock] = useState(false);
  const [onlyDirty, setOnlyDirty] = useState(false);
  const [laneFilter, setLaneFilter] = useState<"all" | VendorLane>("all");
  const [guardedLaneSet, setGuardedLaneSet] = useState<VendorLane[]>(ALL_VENDOR_LANES);
  const [presetKey, setPresetKey] = useState<VendorPresetKey>("scarcity_essentials_protection");
  const [scenarioReport, setScenarioReport] = useState<VendorScenarioReportResponse | null>(null);
  const [scenarioExpandedAt, setScenarioExpandedAt] = useState<string | null>(null);
  const [scenarioActionFilter, setScenarioActionFilter] = useState<"all" | VendorScenarioAction>("all");
  const [scenarioPresetFilter, setScenarioPresetFilter] = useState<"all" | VendorPresetKey>("all");
  const [scenarioLaneFilter, setScenarioLaneFilter] = useState<"all" | VendorLane>("all");
  const [scenarioBridgeBandFilter, setScenarioBridgeBandFilter] = useState<"all" | "open" | "strained" | "restricted">("all");
  const [scenarioVendorStateFilter, setScenarioVendorStateFilter] = useState<"all" | "abundant" | "stable" | "pressured" | "restricted">("all");
  const [scenarioPolicyModeFilter, setScenarioPolicyModeFilter] = useState<"all" | VendorScenarioPolicyMode>("all");
  const [scenarioResponsePhaseFilter, setScenarioResponsePhaseFilter] = useState<"all" | VendorScenarioResponsePhase>("all");
  const [scenarioLimit, setScenarioLimit] = useState(12);
  const [scenarioVendorScope, setScenarioVendorScope] = useState<"current" | "all">("current");
  const [scenarioBeforeCursor, setScenarioBeforeCursor] = useState<string | null>(null);
  const [scenarioCursorHistory, setScenarioCursorHistory] = useState<Array<string | null>>([]);

  async function loadBridgeStatus() {
    try {
      const data = await fetchCityMudBridgeStatus();
      setBridgeStatus(data);
    } catch {
      setBridgeStatus(null);
    }
  }

  function toggleGuardedLane(lane: VendorLane) {
    setGuardedLaneSet((prev) =>
      prev.includes(lane) ? prev.filter((value) => value !== lane) : [...prev, lane]
    );
  }

  function describeLaneSet(lanes: VendorLane[]): string {
    if (lanes.length === 0) return "no lanes";
    if (lanes.length === ALL_VENDOR_LANES.length) return "all lanes";
    if (lanes.length === 1) return `${lanes[0]} lane`;
    return `${lanes.join(", ")} lanes`;
  }

  const selectedPreset = VENDOR_PRESETS.find((preset) => preset.key === presetKey) ?? VENDOR_PRESETS[0];

  async function loadVendors() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ ok: boolean; vendors: VendorSummary[]; error?: string }>(
        "/api/admin/vendor_economy/vendors"
      );
      if (!data?.ok) throw new Error(data?.error || "Unknown error");
      const vs = (data.vendors || []) as VendorSummary[];
      setVendors(vs);
      if (!vendorId && vs.length > 0) setVendorId(vs[0].id);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const itemsUrl = useMemo(() => {
    if (!vendorId) return null;
    const q = new URLSearchParams();
    q.set("vendorId", vendorId);
    q.set("limit", String(limit));
    q.set("offset", String(offset));
    return `/api/admin/vendor_economy/items?${q.toString()}`;
  }, [vendorId, limit, offset]);

  function seedEdits(rows: VendorEconomyItem[]) {
    const next: Record<number, EditRow> = {};
    for (const r of rows) {
      const b = baselineForRow(r);
      next[r.vendor_item_id] = {
        ...b,
        resetStock: false,
      };
    }
    setEdits(next);
  }

  async function loadItems() {
    if (!itemsUrl) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const data = (await api<ItemsResponse>(itemsUrl)) as ItemsResponse;
      if (!data?.ok) throw new Error(data?.error || "Unknown error");

      setItems(data.items || []);
      setTotal(Number(data.total || 0));
      setVendorPolicy(data.vendorPolicy ?? null);
      setVendorRuntimeSummary(data.vendorRuntimeSummary ?? null);

      // NOTE: this will reset edits for the page.
      // That’s OK for explicit refresh/paging/vendor change.
      seedEdits(data.items || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function getScenarioQuery() {
    return {
      action: scenarioActionFilter === "all" ? undefined : scenarioActionFilter,
      presetKey: scenarioPresetFilter,
      lane: scenarioLaneFilter,
      bridgeBand: scenarioBridgeBandFilter,
      vendorState: scenarioVendorStateFilter,
      policyMode: scenarioPolicyModeFilter,
      responsePhase: scenarioResponsePhaseFilter,
      vendorId: scenarioVendorScope === "current" ? vendorId : undefined,
      before: scenarioBeforeCursor ?? undefined,
      limit: scenarioLimit,
    };
  }

  async function downloadScenarioExport(format: "csv" | "json") {
    try {
      setError(null);
      const response = await authedFetch(buildVendorScenarioReportExportUrl(getScenarioQuery(), format));
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Scenario export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const vendorScope = scenarioVendorScope === "current" && vendorId ? vendorId : "all-vendors";
      anchor.href = url;
      anchor.download = `vendor-scenarios-${vendorScope}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  function buildScenarioFilterChips() {
    const chips: string[] = [];
    chips.push(scenarioVendorScope === "current" && vendorId ? `scope:${vendorId}` : "scope:all vendors");
    if (scenarioActionFilter !== "all") chips.push(`action:${scenarioActionFilter}`);
    if (scenarioPresetFilter !== "all") chips.push(`preset:${scenarioPresetFilter}`);
    if (scenarioLaneFilter !== "all") chips.push(`lane:${scenarioLaneFilter}`);
    if (scenarioBridgeBandFilter !== "all") chips.push(`bridge:${scenarioBridgeBandFilter}`);
    if (scenarioVendorStateFilter !== "all") chips.push(`state:${scenarioVendorStateFilter}`);
    if (scenarioPolicyModeFilter !== "all") chips.push(`mode:${scenarioPolicyModeFilter}`);
    if (scenarioResponsePhaseFilter !== "all") chips.push(`phase:${scenarioResponsePhaseFilter}`);
    chips.push(`rows:${scenarioLimit}`);
    return chips;
  }

  function resetScenarioWindowToNewest() {
    setScenarioCursorHistory([]);
    setScenarioBeforeCursor(null);
  }

  function loadOlderScenarioWindow() {
    const nextCursor = scenarioReport?.nextCursor ?? null;
    if (!nextCursor) return;
    setScenarioCursorHistory((prev) => [...prev, scenarioBeforeCursor]);
    setScenarioBeforeCursor(nextCursor);
  }

  function loadNewerScenarioWindow() {
    setScenarioCursorHistory((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const target = next.pop() ?? null;
      setScenarioBeforeCursor(target);
      return next;
    });
  }

  function renderScenarioBucketTable(
    title: string,
    buckets: Array<{ key: string; label: string; entryCount: number; applied: number; softened: number; blocked: number; warnings: number; lastAt: string | null }>,
  ) {
    return (
      <div style={{ minWidth: 260, flex: 1, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {buckets.slice(0, 6).map((bucket) => (
            <div key={`${title}-${bucket.key}`} style={{ paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{bucket.label}</span>
                <span style={{ fontSize: 12, opacity: 0.74 }}>{bucket.entryCount} entries</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, opacity: 0.84, marginTop: 4 }}>
                <span>applied <b>{bucket.applied}</b></span>
                <span>softened <b>{bucket.softened}</b></span>
                <span>blocked <b>{bucket.blocked}</b></span>
                <span>warnings <b>{bucket.warnings}</b></span>
              </div>
              {bucket.lastAt && (
                <div style={{ fontSize: 11, opacity: 0.68, marginTop: 4 }}>last {formatScenarioTimestamp(bucket.lastAt)}</div>
              )}
            </div>
          ))}
          {buckets.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.68 }}>No matching rows in the current review window.</div>
          )}
        </div>
      </div>
    );
  }

  async function loadScenarioLogs() {
    try {
      const data = await fetchVendorScenarioReports(getScenarioQuery());
      if (!data?.ok) throw new Error(data?.error || "Unknown error");
      setScenarioReport(data);
      setScenarioExpandedAt((prev) => (data.entries.some((entry) => entry.at === prev) ? prev : null));
    } catch (e: any) {
      setError((prev) => prev ?? (e?.message || String(e)));
    }
  }

  useEffect(() => {
    loadVendors();
    void loadBridgeStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (scenarioVendorScope === "current" && !vendorId) return;
    void loadScenarioLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, scenarioActionFilter, scenarioPresetFilter, scenarioLaneFilter, scenarioBridgeBandFilter, scenarioVendorStateFilter, scenarioPolicyModeFilter, scenarioResponsePhaseFilter, scenarioVendorScope, scenarioLimit, scenarioBeforeCursor]);

  useEffect(() => {
    setScenarioBeforeCursor(null);
    setScenarioCursorHistory([]);
  }, [vendorId, scenarioActionFilter, scenarioPresetFilter, scenarioLaneFilter, scenarioBridgeBandFilter, scenarioVendorStateFilter, scenarioPolicyModeFilter, scenarioResponsePhaseFilter, scenarioVendorScope, scenarioLimit]);

  useEffect(() => {
    if (!vendorId) return;
    setOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsUrl]);

  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  function getEditForRow(r: VendorEconomyItem): EditRow {
    const existing = edits[r.vendor_item_id];
    if (existing) return existing;
    const b = baselineForRow(r);
    return { ...b, resetStock: false };
  }

  function rowDirty(r: VendorEconomyItem): boolean {
    const e = getEditForRow(r);
    const b = baselineForRow(r);
    return (
      clampStrNum(e.stockMax) !== clampStrNum(b.stockMax) ||
      clampStrNum(e.restockEverySec) !== clampStrNum(b.restockEverySec) ||
      clampStrNum(e.restockAmount) !== clampStrNum(b.restockAmount) ||
      clampStrNum(e.priceMinMult) !== clampStrNum(b.priceMinMult) ||
      clampStrNum(e.priceMaxMult) !== clampStrNum(b.priceMaxMult) ||
      Boolean(e.resetStock)
    );
  }

  const filteredItems = useMemo(() => {
    const needle = qItem.trim().toLowerCase();

    return items.filter((r) => {
      if (needle) {
        const idHit = r.item_id?.toLowerCase().includes(needle);
        const nameHit = (r.item_name ?? "").toLowerCase().includes(needle);
        if (!idHit && !nameHit) return false;
      }

      if (onlyFinite) {
        if (!isFiniteStockMax(r.stock_max ?? null)) return false;
      }

      if (onlyRestock) {
        if (!isRestocking(r.restock_every_sec ?? null, r.restock_amount ?? null)) return false;
      }

      if (onlyDirty) {
        if (!rowDirty(r)) return false;
      }

      if (laneFilter !== "all") {
        if ((r.bridge_lane_policy?.lane ?? "comfort") !== laneFilter) return false;
      }

      return true;
    });
  }, [items, qItem, onlyFinite, onlyRestock, onlyDirty, laneFilter, edits]);

  const dirtyCountAll = useMemo(() => items.filter((r) => rowDirty(r)).length, [items, edits]);
  const dirtyCountVisible = useMemo(
    () => filteredItems.filter((r) => rowDirty(r)).length,
    [filteredItems, edits]
  );

  function setRowEdit(vendorItemId: number, patch: Partial<EditRow>, fallback?: EditRow) {
    setEdits((prev) => {
      const base = prev[vendorItemId] ?? fallback;
      if (!base) return prev;
      return { ...prev, [vendorItemId]: { ...base, ...patch } };
    });
  }

  function stageBridgeRecommendation(row: VendorEconomyItem) {
    const recommendation = row.bridge_recommendation;
    if (!recommendation) return;
    setEdits((prev) => ({
      ...prev,
      [row.vendor_item_id]: {
        ...recommendationToEdit(recommendation),
        resetStock: prev[row.vendor_item_id]?.resetStock ?? false,
      },
    }));
  }

function stageRuntimePreview(row: VendorEconomyItem) {
  const runtimeEffect = row.bridge_runtime_effect;
  if (!runtimeEffect) return;
  setEdits((prev) => ({
    ...prev,
    [row.vendor_item_id]: {
      ...runtimeEffectToEdit(runtimeEffect),
      resetStock: prev[row.vendor_item_id]?.resetStock ?? false,
    },
  }));
}

  function stageBridgeRecommendationsVisible() {
    setEdits((prev) => {
      const next = { ...prev };
      for (const row of filteredItems) {
        const recommendation = row.bridge_recommendation;
        if (!recommendation) continue;
        next[row.vendor_item_id] = {
          ...recommendationToEdit(recommendation),
          resetStock: next[row.vendor_item_id]?.resetStock ?? false,
        };
      }
      return next;
    });
    setNotice(`Staged bridge recommendations for ${filteredItems.filter((row) => row.bridge_recommendation).length} visible row(s).`);
  }

  async function runGuardedRuntimeApply(vendorItemIds: number[], apply: boolean, laneFilters?: VendorLane[], preset?: VendorPresetKey) {
    if (!vendorId || (vendorItemIds.length === 0 && (!laneFilters || laneFilters.length === 0) && !preset)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api<GuardedApplyResponse>(`/api/admin/vendor_economy/bridge_runtime_guarded`, {
        method: "POST",
        body: JSON.stringify({ vendorId, vendorItemIds, laneFilters, presetKey: preset, apply, resetStock: false }),
      });
      if (!data?.ok) throw new Error(data?.error || "Unknown error");
      await loadScenarioLogs();

      if (apply) {
        await loadItems();
        setNotice(`Applied guarded bridge runtime to ${data.appliedCount}/${data.matchedCount} row(s) for ${data.selectionLabel ?? describeLaneSet(laneFilters ?? [])}.`);
        return;
      }

      setEdits((prev) => {
        const next = { ...prev };
        for (const result of data.results || []) {
          if (!result.guardrail?.allowed) continue;
          next[result.vendor_item_id] = {
            stockMax: String(result.guardrail.stockMax),
            restockEverySec: String(result.guardrail.restockEverySec),
            restockAmount: String(result.guardrail.restockAmount),
            priceMinMult: String(result.guardrail.priceMinMult),
            priceMaxMult: String(result.guardrail.priceMaxMult),
            resetStock: next[result.vendor_item_id]?.resetStock ?? false,
          };
        }
        return next;
      });
      const softened = (data.results || []).filter((result) => (result.guardrail?.warnings?.length ?? 0) > 0).length;
      const blocked = (data.results || []).filter((result) => !result.guardrail?.allowed).length;
      setNotice(`Previewed guarded runtime apply for ${data.matchedCount} row(s) across ${data.selectionLabel ?? describeLaneSet(laneFilters ?? [])}; softened ${softened}, blocked ${blocked}.`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function previewGuardedRuntimeVisible() {
    void runGuardedRuntimeApply(filteredItems.map((row) => row.vendor_item_id), false);
  }

  function applyGuardedRuntimeVisible() {
    const ids = filteredItems.map((row) => row.vendor_item_id);
    if (ids.length === 0) return;
    if (!window.confirm(`Apply guarded bridge runtime to ${ids.length} visible row(s)?`)) return;
    void runGuardedRuntimeApply(ids, true);
  }

  function previewGuardedRuntimeLaneSet() {
    if (guardedLaneSet.length === 0) return;
    void runGuardedRuntimeApply([], false, guardedLaneSet);
  }

  function applyGuardedRuntimeLaneSet() {
    if (guardedLaneSet.length === 0) return;
    if (!window.confirm(`Apply guarded bridge runtime to ${describeLaneSet(guardedLaneSet)} for this vendor?`)) return;
    void runGuardedRuntimeApply([], true, guardedLaneSet);
  }

  function previewGuardedRuntimePreset() {
    void runGuardedRuntimeApply([], false, undefined, presetKey);
  }

  function applyGuardedRuntimePreset() {
    if (!window.confirm(`Apply guarded runtime preset "${selectedPreset.label}" to this vendor?`)) return;
    void runGuardedRuntimeApply([], true, undefined, presetKey);
  }

  function previewGuardedRuntimeRow(row: VendorEconomyItem) {
    void runGuardedRuntimeApply([row.vendor_item_id], false);
  }

  function applyGuardedRuntimeRow(row: VendorEconomyItem) {
    if (!window.confirm(`Apply guarded bridge runtime to ${row.item_name ?? row.item_id}?`)) return;
    void runGuardedRuntimeApply([row.vendor_item_id], true);
  }

  async function saveRowInternal(vendorItemId: number): Promise<void> {
    const row = items.find((x) => x.vendor_item_id === vendorItemId);
    if (!row) throw new Error(`Unknown vendor_item_id=${vendorItemId}`);

    const e = getEditForRow(row);

    // Quick client-side sanity (server clamps anyway, but we can avoid obvious footguns).
    const minM = parseOptionalNumber(e.priceMinMult);
    const maxM = parseOptionalNumber(e.priceMaxMult);
    if (minM != null && maxM != null && minM > maxM) {
      throw new Error(`priceMinMult (${minM}) must be <= priceMaxMult (${maxM})`);
    }

    const payload = {
      stockMax: parseOptionalNumber(e.stockMax),
      restockEverySec: parseOptionalNumber(e.restockEverySec),
      restockAmount: parseOptionalNumber(e.restockAmount),
      priceMinMult: parseOptionalNumber(e.priceMinMult),
      priceMaxMult: parseOptionalNumber(e.priceMaxMult),
      resetStock: Boolean(e.resetStock),
    };

    const data = await api<UpdateResponse>(`/api/admin/vendor_economy/items/${vendorItemId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!data?.ok) throw new Error(data?.error || "Unknown error");

    const applied = data.applied;
    if (!applied) {
      // Shouldn’t happen, but keep safe.
      setNotice(`Saved vendor_item_id=${vendorItemId}`);
      setRowEdit(vendorItemId, { resetStock: false });
      return;
    }

    // Update local table row (don’t reload the whole page — preserve other edits).
    setItems((prev) =>
      prev.map((r) => {
        if (r.vendor_item_id !== vendorItemId) return r;

        const nowIso = new Date().toISOString();
        const newStockMax = applied.stockMax;

        return {
          ...r,
          stock_max: newStockMax,
          restock_every_sec: applied.restockEverySec,
          restock_amount: applied.restockAmount,
          restock_per_hour: applied.restockPerHour,
          price_min_mult: applied.priceMinMult,
          price_max_mult: applied.priceMaxMult,
          ...(applied.resetStock
            ? {
                stock: newStockMax > 0 ? newStockMax : 0,
                last_restock_ts: nowIso,
              }
            : {}),
        };
      })
    );

    // Align edit values with applied (clears dirty state for that row).
    setEdits((prev) => ({
      ...prev,
      [vendorItemId]: {
        stockMax: String(applied.stockMax),
        restockEverySec: String(applied.restockEverySec),
        restockAmount: String(applied.restockAmount),
        priceMinMult: String(applied.priceMinMult),
        priceMaxMult: String(applied.priceMaxMult),
        resetStock: false,
      },
    }));

    setNotice(`Saved vendor_item_id=${vendorItemId}`);
  }

  async function saveRow(vendorItemId: number) {
    try {
      setBusy(true);
      setNotice(null);
      setError(null);
      await saveRowInternal(vendorItemId);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function formatScenarioSelectionKind(entry: VendorScenarioReportEntry): string {
    if (entry.selectionKind === "preset") return "preset";
    if (entry.selectionKind === "lane_filters") return "lane set";
    if (entry.selectionKind === "vendor_item_ids") return "explicit rows";
    return "selection";
  }

  function formatScenarioTimestamp(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    return new Date(ms).toLocaleString();
  }

  async function saveDirtyVisible() {
    const targets = filteredItems.filter((r) => rowDirty(r)).map((r) => r.vendor_item_id);
    if (targets.length === 0) return;

    try {
      setBusy(true);
      setNotice(null);
      setError(null);

      // Sequential is safer for DB + easier to reason about.
      // If you want concurrency later, we can cap at 3–5 workers.
      for (const id of targets) {
        await saveRowInternal(id);
      }

      setNotice(`Saved ${targets.length} dirty row(s).`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="Vendor Economy" subtitle="Stock/restock + price knobs for vendor items.">
      <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Vendor Economy Config</h1>

      {bridgeStatus?.summary && (vendorPolicy ?? bridgeStatus.vendorPolicy) && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Current city bridge posture for vendor tuning
              </div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.headline}</div>
              <div style={{ opacity: 0.82, marginTop: 6 }}>{(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.detail}</div>
            </div>
            <div style={{ minWidth: 260 }}>
              <div><b>Band:</b> {bridgeStatus.summary.bridgeBand}</div>
              <div><b>State:</b> {(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.state}</div>
              <div><b>Stock posture:</b> {(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.stockPosture}</div>
              <div><b>Price posture:</b> {(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.pricePosture}</div>
              <div><b>Cadence posture:</b> {(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.cadencePosture}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 13 }}>
            <span>stock × <b>{(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.recommendedStockMultiplier.toFixed(2)}</b></span>
            <span>price min × <b>{(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.recommendedPriceMinMultiplier.toFixed(2)}</b></span>
            <span>price max × <b>{(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.recommendedPriceMaxMultiplier.toFixed(2)}</b></span>
            <span>cadence × <b>{(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.recommendedRestockCadenceMultiplier.toFixed(2)}</b></span>
          </div>
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <b>Recommended action:</b> {(vendorPolicy ?? bridgeStatus?.vendorPolicy)!.recommendedAction}
          </div>
        </div>
      )}

      {vendorRuntimeSummary && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Consequence-aware vendor runtime summary
              </div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{vendorRuntimeSummary.note}</div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                mode <b>{vendorRuntimeSummary.policyMode}</b> • phase <b>{vendorRuntimeSummary.responsePhase}</b> • state <b>{vendorRuntimeSummary.vendorState}</b> • lane bias <b>{vendorRuntimeSummary.laneBias}</b>
              </div>
            </div>
            <div style={{ minWidth: 260 }}>
              <div><b>Runtime states:</b> {Object.entries(vendorRuntimeSummary.runtimeStateCounts).map(([key, value]) => `${key} ${value}`).join(" • ") || "—"}</div>
              <div><b>Lane counts:</b> {Object.entries(vendorRuntimeSummary.laneCounts).map(([key, value]) => `${key} ${value}`).join(" • ") || "—"}</div>
              <div><b>Recommended preset:</b> {vendorRuntimeSummary.recommendedPreset?.label ?? "—"}</div>
            </div>
          </div>
          {vendorRuntimeSummary.recommendedPreset ? (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <b>Why:</b> {vendorRuntimeSummary.recommendedPreset.reason}
            </div>
          ) : null}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Vendor
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            disabled={busy}
            style={{ minWidth: 280 }}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name ? `${v.name} (${v.id})` : v.id}
              </option>
            ))}
            {vendors.length === 0 && <option value="">(no vendors)</option>}
          </select>
        </label>

        <button onClick={() => loadItems()} disabled={busy || !vendorId}>
          Refresh
        </button>

        <button onClick={stageBridgeRecommendationsVisible} disabled={busy || !canWrite || filteredItems.every((row) => !row.bridge_recommendation)}>
          Stage bridge recs
        </button>

        <button onClick={previewGuardedRuntimeVisible} disabled={busy || !canWrite || filteredItems.length === 0}>
          Preview guarded runtime (visible)
        </button>
        <button onClick={applyGuardedRuntimeVisible} disabled={busy || !canWrite || filteredItems.length === 0}>
          Apply guarded runtime (visible)
        </button>
        <button onClick={previewGuardedRuntimeLaneSet} disabled={busy || !canWrite || guardedLaneSet.length === 0}>
          Preview guarded runtime (lane set)
        </button>
        <button onClick={applyGuardedRuntimeLaneSet} disabled={busy || !canWrite || guardedLaneSet.length === 0}>
          Apply guarded runtime (lane set)
        </button>
        <button onClick={previewGuardedRuntimePreset} disabled={busy || !canWrite}>
          Preview preset
        </button>
        <button onClick={applyGuardedRuntimePreset} disabled={busy || !canWrite}>
          Apply preset
        </button>

        <button onClick={saveDirtyVisible} disabled={busy || !canWrite || dirtyCountVisible === 0}>
          Save dirty ({dirtyCountVisible})
        </button>

        <span style={{ opacity: 0.85 }}>
          dirty: <b>{dirtyCountAll}</b> (visible {dirtyCountVisible})
        </span>

        <span style={{ marginLeft: "auto" }}>
          <a href="/" style={{ marginRight: 12 }}>
            Back
          </a>
          <a href="/admin/vendor_audit">Audit Viewer</a>
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Search item
          <ItemPicker
            value={qItem}
            onChange={(v) => setQItem(v)}
            placeholder="item_id or name…"
            disabled={busy}
            style={{ width: 240 }}
            listId="vendor-econ-itempicker"
          />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyFinite} onChange={(e) => setOnlyFinite(e.target.checked)} />
          finite only
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyRestock} onChange={(e) => setOnlyRestock(e.target.checked)} />
          restocking only
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyDirty} onChange={(e) => setOnlyDirty(e.target.checked)} />
          dirty only
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          lane
          <select value={laneFilter} onChange={(e) => setLaneFilter(e.target.value as "all" | VendorLane)} disabled={busy}>
            <option value="all">all</option>
            <option value="essentials">essentials</option>
            <option value="comfort">comfort</option>
            <option value="luxury">luxury</option>
            <option value="arcane">arcane</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>guarded lane set</span>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {ALL_VENDOR_LANES.map((lane) => (
              <label key={lane} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={guardedLaneSet.includes(lane)}
                  onChange={() => toggleGuardedLane(lane)}
                  disabled={busy}
                />
                {lane}
              </label>
            ))}
          </span>
          <span style={{ fontSize: 12, opacity: 0.72 }}>
            explicit target: <b>{describeLaneSet(guardedLaneSet)}</b>
          </span>
        </label>

        <span style={{ marginLeft: 18, display: "flex", gap: 12, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Limit
            <input
              type="number"
              value={limit}
              min={1}
              max={5000}
              onChange={(e) => {
                setOffset(0);
                setLimit(Math.max(1, Math.min(5000, Number(e.target.value) || 500)));
              }}
              style={{ width: 110 }}
            />
          </label>

          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={busy || offset <= 0}>
            Prev
          </button>
          <button
            onClick={() => setOffset(Math.min((pageCount - 1) * limit, offset + limit))}
            disabled={busy || page >= pageCount}
          >
            Next
          </button>

          <span style={{ opacity: 0.8 }}>
            page {page}/{pageCount} · total {total} · showing {filteredItems.length}
          </span>
        </span>
      </div>

      {notice && (
        <div style={{ padding: 10, background: "#e7fff1", border: "1px solid #8fe0b2", marginBottom: 12 }}>
          {notice}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: "#ffebe9", border: "1px solid #ffb4a9", marginBottom: 12 }}>
          <b>Error:</b> {error}
        </div>
      )}

      <div
        style={{
          marginBottom: 16,
          padding: 12,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.035)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Vendor posture replay / reporting</div>
            <div style={{ fontSize: 12, opacity: 0.76, marginTop: 4 }}>
              Read-only view of guarded preview/apply scenarios with filters, rollups, and sample affected rows.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => void loadScenarioLogs()} disabled={busy}>
              Refresh scenario report
            </button>
            <button onClick={() => void downloadScenarioExport("csv")} disabled={busy}>
              Download CSV
            </button>
            <button onClick={() => void downloadScenarioExport("json")} disabled={busy}>
              Download JSON
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            scope
            <select value={scenarioVendorScope} onChange={(e) => setScenarioVendorScope(e.target.value as "current" | "all")}>
              <option value="current">current vendor</option>
              <option value="all">all vendors</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            action
            <select value={scenarioActionFilter} onChange={(e) => setScenarioActionFilter(e.target.value as "all" | VendorScenarioAction)}>
              <option value="all">all</option>
              <option value="preview">preview</option>
              <option value="apply">apply</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            preset
            <select value={scenarioPresetFilter} onChange={(e) => setScenarioPresetFilter(e.target.value as "all" | VendorPresetKey)}>
              <option value="all">all</option>
              {VENDOR_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>{preset.label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            lane
            <select value={scenarioLaneFilter} onChange={(e) => setScenarioLaneFilter(e.target.value as "all" | VendorLane)}>
              <option value="all">all</option>
              {ALL_VENDOR_LANES.map((lane) => <option key={lane} value={lane}>{lane}</option>)}
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            bridge
            <select value={scenarioBridgeBandFilter} onChange={(e) => setScenarioBridgeBandFilter(e.target.value as "all" | "open" | "strained" | "restricted")}>
              <option value="all">all</option>
              <option value="open">open</option>
              <option value="strained">strained</option>
              <option value="restricted">restricted</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            vendor state
            <select value={scenarioVendorStateFilter} onChange={(e) => setScenarioVendorStateFilter(e.target.value as "all" | "abundant" | "stable" | "pressured" | "restricted")}>
              <option value="all">all</option>
              <option value="abundant">abundant</option>
              <option value="stable">stable</option>
              <option value="pressured">pressured</option>
              <option value="restricted">restricted</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            mode
            <select value={scenarioPolicyModeFilter} onChange={(e) => setScenarioPolicyModeFilter(e.target.value as "all" | VendorScenarioPolicyMode)}>
              <option value="all">all</option>
              <option value="bridge_only">bridge_only</option>
              <option value="consequence_aware">consequence_aware</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            phase
            <select value={scenarioResponsePhaseFilter} onChange={(e) => setScenarioResponsePhaseFilter(e.target.value as "all" | VendorScenarioResponsePhase)}>
              <option value="all">all</option>
              <option value="quiet">quiet</option>
              <option value="watch">watch</option>
              <option value="active">active</option>
              <option value="severe">severe</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            rows
            <input
              type="number"
              min={1}
              max={50}
              value={scenarioLimit}
              onChange={(e) => setScenarioLimit(Math.max(1, Math.min(50, Number(e.target.value) || 12)))}
              style={{ width: 80 }}
            />
          </label>
        </div>


        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 12, padding: 10, borderRadius: 10, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12, opacity: 0.82 }}>
            <span><b>window:</b> {scenarioBeforeCursor ? `before ${formatScenarioTimestamp(scenarioBeforeCursor)}` : "newest"}</span>
            <span><b>older:</b> {scenarioReport?.nextCursor ? "available" : "none"}</span>
            <span><b>newer:</b> {scenarioCursorHistory.length > 0 ? "available" : "none"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={resetScenarioWindowToNewest} disabled={busy || (!scenarioBeforeCursor && scenarioCursorHistory.length === 0)}>Newest</button>
            <button onClick={loadNewerScenarioWindow} disabled={busy || scenarioCursorHistory.length === 0}>Newer</button>
            <button onClick={loadOlderScenarioWindow} disabled={busy || !scenarioReport?.nextCursor}>Older</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {buildScenarioFilterChips().map((chip) => (
            <span
              key={chip}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontSize: 12,
                opacity: 0.84,
              }}
            >
              {chip}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          {[
            ["matched", scenarioReport?.review.windowRollups.matched ?? 0],
            ["applied", scenarioReport?.review.windowRollups.applied ?? 0],
            ["softened", scenarioReport?.review.windowRollups.softened ?? 0],
            ["blocked", scenarioReport?.review.windowRollups.blocked ?? 0],
            ["warnings", scenarioReport?.review.windowRollups.warnings ?? 0],
            ["previews", scenarioReport?.review.windowRollups.previews ?? 0],
            ["applies", scenarioReport?.review.windowRollups.applies ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.05)", minWidth: 92 }}>
              <div style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.76 }}>
          showing {scenarioReport?.entries.length ?? 0} scenario row(s)
          {scenarioVendorScope === "current" && vendorId ? ` for vendor ${vendorId}` : " across all vendors"}
          {scenarioReport?.malformedCount ? ` · skipped malformed historical rows: ${scenarioReport.malformedCount}` : ""}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          {[
            ["review window", scenarioReport?.review.reviewWindowSize ?? 0],
            ["matching entries", scenarioReport?.review.totalMatchingEntries ?? 0],
            ["vendors", scenarioReport?.review.distinctVendors ?? 0],
            ["presets", scenarioReport?.review.distinctPresets ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.05)", minWidth: 92 }}>
              <div style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          {renderScenarioBucketTable("Action mix", scenarioReport?.review.byAction ?? [])}
          {renderScenarioBucketTable("Per-preset performance", scenarioReport?.review.byPreset ?? [])}
          {renderScenarioBucketTable("Lane rollups", scenarioReport?.review.byLane ?? [])}
          {renderScenarioBucketTable("Bridge bands", scenarioReport?.review.byBridgeBand ?? [])}
          {renderScenarioBucketTable("Vendor states", scenarioReport?.review.byVendorState ?? [])}
          {renderScenarioBucketTable("Policy modes", scenarioReport?.review.byPolicyMode ?? [])}
          {renderScenarioBucketTable("Response phases", scenarioReport?.review.byResponsePhase ?? [])}
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {(scenarioReport?.entries ?? []).map((entry) => {
            const expanded = scenarioExpandedAt === entry.at;
            return (
              <div key={`${entry.at}-${entry.vendorId}-${entry.action}`} style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{entry.note}</div>
                    <div style={{ fontSize: 12, opacity: 0.74, marginTop: 4 }}>
                      {formatScenarioTimestamp(entry.at)} · {entry.action} · {formatScenarioSelectionKind(entry)} · vendor {entry.vendorId}
                    </div>
                  </div>
                  <button onClick={() => setScenarioExpandedAt(expanded ? null : entry.at)}>
                    {expanded ? "Hide details" : "Show details"}
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, fontSize: 12 }}>
                  <span><b>selection:</b> {entry.selectionLabel}</span>
                  <span><b>lanes:</b> {entry.laneFilters.length ? entry.laneFilters.join(", ") : "none"}</span>
                  <span><b>bridge:</b> {entry.bridgeBand}</span>
                  <span><b>state:</b> {entry.vendorState}</span>
                  <span><b>mode:</b> {entry.policyMode}</span>
                  <span><b>phase:</b> {entry.responsePhase ?? "—"}</span>
                  <span><b>lane bias:</b> {entry.laneBias ?? "—"}</span>
                  <span><b>preset:</b> {entry.presetKey ?? "—"}</span>
                </div>

                {expanded && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
                      <span>matched <b>{entry.matchedCount}</b></span>
                      <span>applied <b>{entry.appliedCount}</b></span>
                      <span>softened <b>{entry.softenedCount}</b></span>
                      <span>blocked <b>{entry.blockedCount}</b></span>
                      <span>warnings <b>{entry.warningCount}</b></span>
                    </div>

                    {entry.topWarnings.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>Top warnings</div>
                        <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                          {entry.topWarnings.map((warning) => <li key={warning} style={{ fontSize: 12 }}>{warning}</li>)}
                        </ul>
                      </div>
                    )}

                    {entry.sampleItems.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Sample affected rows</div>
                        <div style={{ display: "grid", gap: 8 }}>
                          {entry.sampleItems.map((sample) => (
                            <div key={`${entry.at}-${sample.vendorItemId}`} style={{ padding: 8, borderRadius: 10, background: "rgba(255,255,255,0.04)", fontSize: 12 }}>
                              <div style={{ fontWeight: 600 }}>
                                {sample.itemName ?? sample.itemId} <code>({sample.itemId})</code>
                              </div>
                              <div style={{ marginTop: 4, opacity: 0.82 }}>
                                row {sample.vendorItemId} · lane {sample.lane ?? "?"} · runtime {sample.runtimeState ?? "?"} · {sample.allowed ? "allowed" : "blocked"} · {sample.applied ? "applied" : "not applied"}
                              </div>
                              {sample.warnings.length > 0 && (
                                <div style={{ marginTop: 4, opacity: 0.8 }}>
                                  warnings: {sample.warnings.join(" · ")}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {(scenarioReport?.entries.length ?? 0) === 0 && (
            <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,0.03)", fontSize: 12, opacity: 0.76 }}>
              No scenario entries match the current filters.
            </div>
          )}
        </div>
      </div>

      {busy && <div style={{ marginBottom: 8 }}>Loading…</div>}

      <div style={{ overflowX: "auto" }}>
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th />
              <th>rowId</th>
              <th>item</th>
              <th>base</th>
              <th>stock</th>
              <th>stockMax</th>
              <th>restockEverySec</th>
              <th>restockAmount</th>
              <th>restock/hr</th>
              <th>priceMinMult</th>
              <th>priceMaxMult</th>
              <th>bridge rec</th>
              <th>runtime preview</th>
              <th>lastRestock</th>
              <th>resetStock</th>
              <th>save</th>
            </tr>
          </thead>

          <tbody>
            {filteredItems.map((r) => {
              const e = getEditForRow(r);
              const dirty = rowDirty(r);

              const stockLabel = formatStockLabel(r.stock, r.stock_max);
              const restockActive = isRestocking(r.restock_every_sec ?? null, r.restock_amount ?? null);

              // Inline edit parsing (lightweight hints)
              const minM = parseOptionalNumber(e.priceMinMult);
              const maxM = parseOptionalNumber(e.priceMaxMult);
              const multBad = minM != null && maxM != null && minM > maxM;

              const rowStyle: React.CSSProperties = {
                borderBottom: "1px solid #eee",
                verticalAlign: "top",
                background: dirty ? "#fff9e6" : undefined,
              };

              const dirtyDotStyle: React.CSSProperties = {
                width: 12,
                textAlign: "center",
                color: dirty ? "#d07a00" : "#ccc",
                fontWeight: 900,
              };

              return (
                <tr key={r.vendor_item_id} style={rowStyle}>
                  <td style={dirtyDotStyle} title={dirty ? "Unsaved changes" : "Clean"}>
                    {dirty ? "●" : "·"}
                  </td>

                  <td style={{ whiteSpace: "nowrap" }}>{r.vendor_item_id}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.item_name ? (
                      <>
                        {r.item_name} <code>({r.item_id})</code>
                      </>
                    ) : (
                      <code>{r.item_id}</code>
                    )}
                    {r.item_rarity ? (
                      <span style={{ marginLeft: 8, opacity: 0.75, fontSize: 12 }}>[{r.item_rarity}]</span>
                    ) : null}
                    {r.bridge_lane_policy ? (
                      <span style={{ marginLeft: 8, opacity: 0.85, fontSize: 12 }} title={r.bridge_lane_policy.laneDetail}>⟨{r.bridge_lane_policy.lane}⟩</span>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.base_price_gold}</td>

                  <td style={{ whiteSpace: "nowrap" }}>
                    {stockLabel}
                    {isFiniteStockMax(r.stock_max) ? (
                      <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>(finite)</span>
                    ) : (
                      <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>(∞/disabled)</span>
                    )}
                  </td>

                  <td>
                    <input
                      value={e.stockMax ?? ""}
                      onChange={(ev) => setRowEdit(r.vendor_item_id, { stockMax: ev.target.value }, e)}
                      style={{ width: 90 }}
                    />
                  </td>

                  <td>
                    <input
                      value={e.restockEverySec ?? ""}
                      onChange={(ev) => setRowEdit(r.vendor_item_id, { restockEverySec: ev.target.value }, e)}
                      style={{ width: 120 }}
                    />
                  </td>

                  <td>
                    <input
                      value={e.restockAmount ?? ""}
                      onChange={(ev) => setRowEdit(r.vendor_item_id, { restockAmount: ev.target.value }, e)}
                      style={{ width: 120 }}
                    />
                  </td>

                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.restock_per_hour ?? 0}
                    {restockActive ? (
                      <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>(active)</span>
                    ) : (
                      <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.75 }}>(off)</span>
                    )}
                  </td>

                  <td>
                    <input
                      value={e.priceMinMult ?? ""}
                      onChange={(ev) => setRowEdit(r.vendor_item_id, { priceMinMult: ev.target.value }, e)}
                      style={{
                        width: 110,
                        borderColor: multBad ? "#d00" : undefined,
                        outlineColor: multBad ? "#d00" : undefined,
                      }}
                    />
                  </td>

                  <td>
                    <input
                      value={e.priceMaxMult ?? ""}
                      onChange={(ev) => setRowEdit(r.vendor_item_id, { priceMaxMult: ev.target.value }, e)}
                      style={{
                        width: 110,
                        borderColor: multBad ? "#d00" : undefined,
                        outlineColor: multBad ? "#d00" : undefined,
                      }}
                    />
                    {multBad && (
                      <div style={{ fontSize: 11, color: "#d00", marginTop: 2 }}>min must be ≤ max</div>
                    )}
                  </td>

                  <td style={{ minWidth: 250 }}>
                    {r.bridge_recommendation ? (
                      <>
                        {r.bridge_lane_policy ? (
                          <div style={{ fontSize: 11, opacity: 0.78, marginBottom: 4 }} title={r.bridge_lane_policy.laneDetail}>
                            lane <b>{r.bridge_lane_policy.laneLabel}</b> · state {r.bridge_lane_policy.state} · {r.bridge_lane_policy.stockPosture}/{r.bridge_lane_policy.pricePosture}/{r.bridge_lane_policy.cadencePosture}
                          </div>
                        ) : null}
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{r.bridge_recommendation.headline}</div>
                        <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                          stock {r.bridge_recommendation.stockMax} · cadence {r.bridge_recommendation.restockEverySec || 0}s/{r.bridge_recommendation.restockAmount || 0} · price {r.bridge_recommendation.priceMinMult.toFixed(2)}–{r.bridge_recommendation.priceMaxMult.toFixed(2)}
                        </div>
                        <button
                          onClick={() => stageBridgeRecommendation(r)}
                          disabled={busy || !canWrite}
                          style={{ marginTop: 6 }}
                          title={r.bridge_lane_policy ? `${r.bridge_recommendation.detail}

${r.bridge_lane_policy.recommendedAction}` : r.bridge_recommendation.detail}
                        >
                          Use bridge rec
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, opacity: 0.65 }}>No live bridge recommendation.</span>
                    )}
                  </td>

                  <td style={{ minWidth: 230 }}>
                    {r.bridge_runtime_effect ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{r.bridge_runtime_effect.headline}</div>
                        <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                          {r.bridge_runtime_effect.state} · stock {r.bridge_runtime_effect.effectiveStockMax} · cadence {r.bridge_runtime_effect.effectiveRestockEverySec || 0}s/{r.bridge_runtime_effect.effectiveRestockAmount || 0} · price {r.bridge_runtime_effect.effectivePriceMinMult.toFixed(2)}–{r.bridge_runtime_effect.effectivePriceMaxMult.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.72, marginTop: 4 }} title={r.bridge_runtime_effect.detail}>
                          {r.bridge_runtime_effect.stockFillRatio != null ? `fill ${(r.bridge_runtime_effect.stockFillRatio * 100).toFixed(0)}%` : 'no finite stock cap'}
                        </div>
                        <button
                          onClick={() => stageRuntimePreview(r)}
                          disabled={busy || !canWrite}
                          style={{ marginTop: 6 }}
                          title={r.bridge_runtime_effect.detail}
                        >
                          Use runtime preview
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, opacity: 0.65 }}>No live runtime preview.</span>
                    )}
                  </td>

                  <td style={{ whiteSpace: "nowrap" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {(() => {
                        if (!r.last_restock_ts) return "—";
                        const ms = parseIsoMs(r.last_restock_ts);
                        if (!ms) return r.last_restock_ts;
                        return new Date(ms).toLocaleString();
                      })()}
                    </div>
                    {(() => {
                      const t = getNextRestockLabel(r, nowMs);
                      if (!t) return null;
                      return (
                        <div style={{ marginTop: 2, fontSize: 11, opacity: 0.75 }} title={t.title}>
                          {t.line}
                        </div>
                      );
                    })()}
                  </td>

                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(e.resetStock)}
                      onChange={(ev) => setRowEdit(r.vendor_item_id, { resetStock: ev.target.checked }, e)}
                    />
                  </td>

                  <td>
                    <button onClick={() => saveRow(r.vendor_item_id)} disabled={busy || !canWrite || !dirty}>
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}

            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={15} style={{ padding: 12, opacity: 0.7 }}>
                  No vendor items match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
        Backend: <code>/api/admin/vendor_economy</code> · Edits are clamped server-side to keep configs safe. · This page
        uses same-origin API via <code>web-frontend/lib/api.ts</code>.
      </div>
    </div>
    </AdminShell>
  );
}
