// web-frontend/pages/AdminMotherBrainPage.tsx
//
// Mother Brain Status (v1)
//
// Goal:
// - Give the Admin UI a readable, same-origin way to view Mother Brain heartbeats.
// - Avoid requiring Mother Brain to host its own HTTP server.
//
// Data source:
//   GET /api/admin/mother_brain/status

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { AdminShell, AdminPanel, AdminNotice } from "../components/admin/AdminUI";

type MotherBrainHeartbeat = {
  service_name: string;
  instance_id: string;
  host: string;
  pid: number;

  version: string | null;
  mode: string | null;

  ready: boolean;
  last_tick: number | null;
  last_signature: string | null;
  last_status_json: any | null;

  started_at: string;
  last_tick_at: string;
  updated_at: string;
};

type MotherBrainStatusResponse = {
  ok: boolean;
  status: MotherBrainHeartbeat | null;
  warning?: string;
  detail?: string;
  error?: string;
};

type WaveBudgetCapRow = {
  shard_id: string;
  type: string;
  cap: number | string;
  policy: string;
  updated_at: string;
};

type WaveBudgetUsageRow = {
  shard_id: string;
  type: string;
  count: number | string;
};

type WaveBudgetResponse = {
  ok: boolean;
  caps: WaveBudgetCapRow[];
  usage: WaveBudgetUsageRow[];
  warning?: string;
  detail?: string;
  error?: string;
};

type GoalsProxyInfoResponse = {
  ok: boolean;
  enabled: boolean;
  baseUrl?: string;
};

function safeIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function msAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Date.now() - d.getTime();
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

function prettyJson(v: any): string {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return String(v);
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

type BrainWaveBudgetEntry = { shardId: string; type: string; count: number };

function parseBrainSpawnsTopByShardType(raw: unknown): BrainWaveBudgetEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BrainWaveBudgetEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as any;
    const shardId = typeof o.shardId === "string" ? o.shardId : typeof o.shard_id === "string" ? o.shard_id : null;
    const type = typeof o.type === "string" ? o.type : null;
    const count = typeof o.count === "number" ? o.count : typeof o.count === "string" ? Number(o.count) : NaN;
    if (!shardId || !type || !Number.isFinite(count)) continue;
    out.push({ shardId, type, count });
  }
  return out;
}

function parseBrainWaveBudget(
  raw: unknown,
):
  | null
  | {
      kind: "ok";
      total: number;
      top: Array<{ shardId: string; type: string; count: number }>;
    }
  | {
      kind: "unavailable";
      reason: string;
      missingColumns?: string[];
    } {
  if (!raw || typeof raw !== "object") return null;

  const anyRaw = raw as any;

  // New shape: { ok: true/false, ... }
  if (typeof anyRaw.ok === "boolean") {
    if (!anyRaw.ok) {
      const reason = typeof anyRaw.reason === "string" ? anyRaw.reason : "unavailable";
      const missingColumns =
        Array.isArray(anyRaw.missingColumns) && anyRaw.missingColumns.every((x: any) => typeof x === "string")
          ? (anyRaw.missingColumns as string[])
          : undefined;

      return { kind: "unavailable", reason, missingColumns };
    }

    const total = typeof anyRaw.total === "number" ? anyRaw.total : null;
    const top = parseBrainSpawnsTopByShardType(anyRaw.topByShardType);

    if (total === null || !top) return null;

    return { kind: "ok", total, top };
  }

  // Legacy shape: { total, topByShardType }
  const total = typeof anyRaw.total === "number" ? anyRaw.total : null;
  const top = parseBrainSpawnsTopByShardType(anyRaw.topByShardType);
  if (total === null || !top) return null;
  return { kind: "ok", total, top };
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

type GoalsHealthSummary = {
  status: "OK" | "FAIL" | "STALE";
  ageSec: number | null;
  okCount: number | null;
  failCount: number | null;
  totalCount: number | null;
  failingSuites: string[];
  failingGoals: {
    suiteId: string;
    id: string;
    kind: string;
    error: string | null;
    latencyMs: number | null;
    details: Record<string, unknown> | null;
  }[];
};

type GoalsSuiteLast = {
  suiteId: string;
  status: "OK" | "FAIL" | "STALE";
  ageSec: number | null;
  okCount: number | null;
  failCount: number | null;
  totalCount: number | null;
};

type GoalsReportTailResponse =
  | {
      ok: true;
      suite: string;
      date: string;
      filename: string;
      lines: unknown[];
    }
  | {
      ok: false;
      error: string;
      detail?: string;
    };

type GoalReportFailingLine = {
  suite: string;
  ts: string | null;
  tick: number | null;
  goalId: string;
  kind: string;
  error: string | null;
  latencyMs: number | null;
  details: unknown;
};

type GoalReportFailingRun = {
  suite: string;
  ts: string | null;
  tick: number | null;
  failures: GoalReportFailingLine[];
};

function extractFailingLinesFromReportTail(suite: string, lines: unknown[], max: number): GoalReportFailingLine[] {
  const out: GoalReportFailingLine[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const rec: any = lines[i];
    if (!rec || typeof rec !== "object") continue;

    const results = Array.isArray(rec.results) ? rec.results : null;
    if (!results) continue;

    const ts = typeof rec.ts === "string" ? rec.ts : null;
    const tick = typeof rec.tick === "number" && Number.isFinite(rec.tick) ? Math.trunc(rec.tick) : null;

    for (const r of results) {
      if (!r || typeof r !== "object") continue;
      if (r.ok === true) continue;

      const goalId = typeof r.id === "string" ? r.id : "(unknown)";
      const kind = typeof r.kind === "string" ? r.kind : "(unknown)";
      const error = typeof r.error === "string" ? r.error : null;
      const latencyMs = typeof r.latencyMs === "number" && Number.isFinite(r.latencyMs) ? r.latencyMs : null;
      const details = (r as any).details ?? null;

      out.push({ suite, ts, tick, goalId, kind, error, latencyMs, details });

      if (out.length >= max) return out;
    }
  }

  return out;
}

function extractLatestFailingRunFromReportTail(suite: string, lines: unknown[], max: number): GoalReportFailingRun | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const rec: any = lines[i];
    if (!rec || typeof rec !== "object") continue;
    const results = Array.isArray(rec.results) ? rec.results : null;
    if (!results) continue;

    const failures: GoalReportFailingLine[] = [];
    const ts = typeof rec.ts === "string" ? rec.ts : null;
    const tick = typeof rec.tick === "number" && Number.isFinite(rec.tick) ? Math.trunc(rec.tick) : null;

    for (const r of results) {
      if (!r || typeof r !== "object") continue;
      if (r.ok === true) continue;

      const goalId = typeof r.id === "string" ? r.id : "(unknown)";
      const kind = typeof r.kind === "string" ? r.kind : "(unknown)";
      const error = typeof r.error === "string" ? r.error : null;
      const latencyMs = typeof r.latencyMs === "number" && Number.isFinite(r.latencyMs) ? r.latencyMs : null;
      const details = (r as any).details ?? null;

      failures.push({ suite, ts, tick, goalId, kind, error, latencyMs, details });
      if (failures.length >= max) break;
    }

    if (failures.length) return { suite, ts, tick, failures };
  }

  return null;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function parseGoalsHealthSummary(snapshot: any): { overall: GoalsHealthSummary | null; suites: GoalsSuiteLast[] } {
  const goals = snapshot && typeof snapshot === "object" ? (snapshot as any).goals : null;
  const health = goals && typeof goals === "object" ? (goals as any).health : null;
  const lastBySuite = goals && typeof goals === "object" ? (goals as any).lastBySuite : null;

  const suites: GoalsSuiteLast[] = [];
  if (lastBySuite && typeof lastBySuite === "object") {
    for (const [suiteId, v] of Object.entries(lastBySuite)) {
      if (!suiteId || typeof suiteId !== "string") continue;
      if (!v || typeof v !== "object") continue;
      const o = v as any;
      const status = o.status === "OK" || o.status === "FAIL" || o.status === "STALE" ? o.status : null;
      if (!status) continue;

      suites.push({
        suiteId,
        status,
        ageSec: typeof o.ageSec === "number" && Number.isFinite(o.ageSec) ? o.ageSec : null,
        okCount: typeof o.okCount === "number" && Number.isFinite(o.okCount) ? o.okCount : null,
        failCount: typeof o.failCount === "number" && Number.isFinite(o.failCount) ? o.failCount : null,
        totalCount: typeof o.totalCount === "number" && Number.isFinite(o.totalCount) ? o.totalCount : null,
      });
    }
    suites.sort((a, b) => a.suiteId.localeCompare(b.suiteId));
  }

  if (!health || typeof health !== "object") return { overall: null, suites };

  const status = (health as any).status;
  const normStatus = status === "OK" || status === "FAIL" || status === "STALE" ? status : null;

  const ageSec = typeof (health as any).ageSec === "number" && Number.isFinite((health as any).ageSec) ? (health as any).ageSec : null;

  const overallObj = (health as any).overall && typeof (health as any).overall === "object" ? (health as any).overall : null;
  const okCount = overallObj && typeof overallObj.okCount === "number" && Number.isFinite(overallObj.okCount) ? overallObj.okCount : null;
  const failCount = overallObj && typeof overallObj.failCount === "number" && Number.isFinite(overallObj.failCount) ? overallObj.failCount : null;
  const totalCount = overallObj && typeof overallObj.totalCount === "number" && Number.isFinite(overallObj.totalCount) ? overallObj.totalCount : null;

  const failingGoalsRaw = overallObj && Array.isArray(overallObj.failingGoals) ? (overallObj.failingGoals as unknown[]) : [];
  const failingGoals = failingGoalsRaw
    .filter((x: unknown) => x && typeof x === "object")
    .map((x: unknown) => {
      const o = x as any;
      return {
        suiteId: typeof o.suiteId === "string" ? o.suiteId : "",
        id: typeof o.id === "string" ? o.id : "",
        kind: typeof o.kind === "string" ? o.kind : "",
        error: typeof o.error === "string" ? o.error : null,
        latencyMs: typeof o.latencyMs === "number" && Number.isFinite(o.latencyMs) ? o.latencyMs : null,
        details: o.details && typeof o.details === "object" ? (o.details as Record<string, unknown>) : null,
      };
    })
    .filter((g) => g.suiteId && g.id && g.kind);

  const suitesObj = (health as any).suites && typeof (health as any).suites === "object" ? (health as any).suites : null;
  const failingSuites =
    suitesObj && Array.isArray(suitesObj.failingSuites) && suitesObj.failingSuites.every((x: any) => typeof x === "string")
      ? (suitesObj.failingSuites as string[])
      : [];

  if (!normStatus) return { overall: null, suites };

  return {
    overall: {
      status: normStatus,
      ageSec,
      okCount,
      failCount,
      totalCount,
      failingSuites,
      failingGoals,
    },
    suites,
  };
}

function goalsBadgeStyle(status: "OK" | "FAIL" | "STALE"): any {
  const base: any = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2px 10px",
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: 0.3,
    border: "1px solid #ddd",
  };

  if (status === "OK") return { ...base, background: "#e8f7ee", color: "#0a6b2b", borderColor: "#bfe6cc" };
  if (status === "FAIL") return { ...base, background: "#fdecec", color: "#9b1111", borderColor: "#f3b6b6" };
  return { ...base, background: "#fff6e6", color: "#8a4b00", borderColor: "#f1d6a6" };
}


export function AdminMotherBrainPage() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MotherBrainHeartbeat | null>(null);
  const [raw, setRaw] = useState<MotherBrainStatusResponse | null>(null);

  const [goalsProxyEnabled, setGoalsProxyEnabled] = useState(false);
  const [goalsProxyBase, setGoalsProxyBase] = useState<string | null>(null);
  const [goalsRunBusy, setGoalsRunBusy] = useState(false);
  const [goalsRunResult, setGoalsRunResult] = useState<any | null>(null);

  // Optional caps table (spawn_wave_budgets) + derived usage.
  const [waveCaps, setWaveCaps] = useState<WaveBudgetCapRow[]>([]);
  const [waveUsage, setWaveUsage] = useState<WaveBudgetUsageRow[]>([]);
  const [waveNotice, setWaveNotice] = useState<string | null>(null);

  const snapshot = data?.last_status_json ?? null;
  const goalsSummary = useMemo(() => parseGoalsHealthSummary(snapshot), [snapshot]);

  const suiteOptions = useMemo(() => {
    const s = goalsSummary.suites.map((x) => x.suiteId).filter((x) => typeof x === "string" && x.trim() !== "");
    if (!s.length) return ["custom"];
    return s;
  }, [goalsSummary.suites]);

  const [reportSuite, setReportSuite] = useState<string>("custom");
  const [reportLines, setReportLines] = useState(200);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportData, setReportData] = useState<GoalsReportTailResponse | null>(null);

  const [reportOnlyFailures, setReportOnlyFailures] = useState(true);
  const [reportLatestFailingRunOnly, setReportLatestFailingRunOnly] = useState(true);
  const [reportShowRaw, setReportShowRaw] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);

  useEffect(() => {
    // Keep selection valid if packs change.
    if (!suiteOptions.length) return;
    if (suiteOptions.includes(reportSuite)) return;
    setReportSuite(suiteOptions[0] ?? "custom");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suiteOptions.join("|")]);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [everyMs, setEveryMs] = useState(2000);
  const timerRef = useRef<number | null>(null);

  // Avoid overlapping polls even if React state lags.
  const inFlightRef = useRef(false);

  const staleMs = useMemo(() => msAgo(data?.updated_at), [data?.updated_at]);
  const tickAgeMs = useMemo(() => msAgo(data?.last_tick_at), [data?.last_tick_at]);

  const isStale = (staleMs ?? 0) > 15_000;
  const isTickStale = (tickAgeMs ?? 0) > 15_000;

  const load = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await api<MotherBrainStatusResponse>("/api/admin/mother_brain/status");
      setRaw(res);

      if (!res.ok) {
        setData(null);
        setError(res.error || "Mother Brain status request failed.");
      } else {
        setData(res.status ?? null);

        if (res.warning) {
          setNotice(res.detail ? `${res.warning}: ${res.detail}` : res.warning);
        }
      }

      // Optional: discover whether the web-backend can proxy to Mother Brain's HTTP status server.
      // This enables a "Run goals now" button (dev-only; disabled unless configured).
      try {
        const pi = await api<GoalsProxyInfoResponse>("/api/admin/mother_brain/goals_proxy_info");
        if (pi && pi.ok) {
          setGoalsProxyEnabled(Boolean(pi.enabled));
          setGoalsProxyBase(typeof pi.baseUrl === "string" ? pi.baseUrl : null);
        } else {
          setGoalsProxyEnabled(false);
          setGoalsProxyBase(null);
        }
      } catch {
        setGoalsProxyEnabled(false);
        setGoalsProxyBase(null);
      }

      // Wave budget caps are optional. If missing, don't treat it as fatal.
      try {
        const wb = await api<WaveBudgetResponse>("/api/admin/mother_brain/wave_budget");
        if (wb.ok) {
          setWaveCaps(Array.isArray(wb.caps) ? wb.caps : []);
          setWaveUsage(Array.isArray(wb.usage) ? wb.usage : []);
          setWaveNotice(wb.warning ? (wb.detail ? `${wb.warning}: ${wb.detail}` : wb.warning) : null);
        } else {
          setWaveCaps([]);
          setWaveUsage([]);
          setWaveNotice(wb.error || "wave_budget request failed");
        }
      } catch (e: any) {
        setWaveCaps([]);
        setWaveUsage([]);
        setWaveNotice(e?.message ? String(e.message) : String(e));
      }
    } catch (e: any) {
      setRaw(null);
      setData(null);
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  const runGoalsNow = async () => {
    if (!goalsProxyEnabled || goalsRunBusy) return;
    setGoalsRunBusy(true);
    setError(null);
    setNotice(null);
    setGoalsRunResult(null);

    try {
      const r = await api<any>("/api/admin/mother_brain/goals/run", { method: "POST" });
      setGoalsRunResult(r);

      if (!r?.ok) {
        setError(r?.error || "Goals run failed.");
      } else {
        setNotice("Goals run completed.");
      }

      // Refresh DB snapshot view (the run result is returned directly, but this keeps the page coherent).
      await load();
    } catch (e: any) {
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setGoalsRunBusy(false);
    }
  };

  const loadReportTail = async () => {
    if (reportBusy) return;
    setReportBusy(true);
    setReportData(null);
    try {
      const suite = (reportSuite || "custom").trim();
      const lines = Math.max(1, Math.min(500, Math.trunc(reportLines || 200)));
      const qs = new URLSearchParams({ suite, lines: String(lines) }).toString();
      const r = await api<GoalsReportTailResponse>(`/api/admin/mother_brain/goals/report_tail?${qs}`);
      setReportData(r);
    } catch (e: any) {
      setReportData({ ok: false, error: "report_tail_failed", detail: e?.message ? String(e.message) : String(e) });
    } finally {
      setReportBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!autoRefresh) return;

    const ms = Math.max(500, Math.min(60_000, Math.floor(everyMs)));
    timerRef.current = window.setInterval(() => {
      void load();
    }, ms);

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, everyMs]);

  const waveBudget = useMemo(() => parseBrainWaveBudget(snapshot?.brainWaveBudget), [snapshot]);

  const apiJson = useMemo(() => prettyJson(raw), [raw]);
  const snapshotJson = useMemo(() => prettyJson(snapshot), [snapshot]);

  const [copiedApi, setCopiedApi] = useState(false);
  const [copiedSnapshot, setCopiedSnapshot] = useState(false);

  // Simple local editor state for caps.
  const [newShardId, setNewShardId] = useState("prime_shard");
  const [newType, setNewType] = useState("npc");
  const [newCap, setNewCap] = useState("50");
  const [newPolicy, setNewPolicy] = useState("hard");

  const usageMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of waveUsage) {
      const shard = u?.shard_id;
      const type = u?.type;
      const count = toInt((u as any)?.count);
      if (!shard || !type || count == null) continue;
      m.set(`${shard}:${type}`, count);
    }
    return m;
  }, [waveUsage]);

  const handleUpsertCap = async (shardId: string, type: string, cap: number, policy: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await api<any>("/api/admin/mother_brain/wave_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shardId, type, cap, policy }),
      });

      if (!res?.ok) {
        setError(res?.error || "Failed to save wave budget cap.");
        return;
      }

      setNotice("Wave budget cap saved.");
      await load();
    } catch (e: any) {
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteCap = async (cap: { shard_id: string; type: string }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const shard = encodeURIComponent(cap.shard_id);
      const type = encodeURIComponent(cap.type);
      const res = await api<any>(`/api/admin/mother_brain/wave_budget/${shard}/${type}`, {
        method: "DELETE",
      });

      if (!res?.ok) {
        setError(res?.error || "Failed to delete wave budget cap.");
        return;
      }

      setNotice("Wave budget cap deleted.");
      await load();
    } catch (e: any) {
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Mother Brain" subtitle="Service heartbeat + last status snapshot (pulled from web-backend).">
      <AdminPanel title="Mother Brain" subtitle="Service heartbeat + last status snapshot (pulled from web-backend).">
        {notice ? <AdminNotice kind="warn">{notice}</AdminNotice> : null}
        {waveNotice ? <AdminNotice kind="warn">{waveNotice}</AdminNotice> : null}
        {error ? <AdminNotice kind="error">{error}</AdminNotice> : null}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <button disabled={busy} onClick={() => void load()}>
            Refresh
          </button>

          <a href="#" onClick={(e) => {
            e.preventDefault();
            setCopiedApi(false);
            void copyToClipboard(apiJson).then((ok) => setCopiedApi(ok));
          }}>
            Open API response
          </a>

          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto refresh
          </label>

          <span>Every</span>
          <input
            type="number"
            min={500}
            max={60000}
            value={everyMs}
            onChange={(e) => setEveryMs(Math.max(500, Math.min(60000, Number(e.target.value) || 2000)))}
            style={{ width: 90 }}
          />
          <span>ms</span>

          {copiedApi ? <span style={{ marginLeft: 8 }}>Copied.</span> : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Heartbeat</div>

            {data ? (
              <table style={{ width: "100%" }}>
                <tbody>
                  <tr>
                    <td style={{ width: 110 }}>service</td>
                    <td>
                      <code>{data.service_name}</code>
                    </td>
                  </tr>
                  <tr>
                    <td>instance</td>
                    <td>
                      <code>{data.instance_id}</code>
                    </td>
                  </tr>
                  <tr>
                    <td>host / pid</td>
                    <td>
                      <code>
                        {data.host}:{data.pid}
                      </code>
                    </td>
                  </tr>
                  <tr>
                    <td>version</td>
                    <td>
                      <code>{data.version ?? ""}</code>
                    </td>
                  </tr>
                  <tr>
                    <td>mode</td>
                    <td>
                      <code>{data.mode ?? ""}</code>
                    </td>
                  </tr>
                  <tr>
                    <td>ready</td>
                    <td>
                      <span style={{ fontWeight: 700, color: data.ready ? "green" : "red" }}>
                        {data.ready ? "READY" : "NOT READY"}
                      </span>
                      {isStale ? <span style={{ marginLeft: 8, color: "#b00" }}>(stale)</span> : null}
                    </td>
                  </tr>
                  <tr>
                    <td>last tick</td>
                    <td>
                      <code>{data.last_tick ?? ""}</code>
                      {tickAgeMs != null ? <span style={{ marginLeft: 8 }}>({fmtMs(tickAgeMs)} ago)</span> : null}
                      {isTickStale ? <span style={{ marginLeft: 8, color: "#b00" }}>(tick stale)</span> : null}
                    </td>
                  </tr>
                  <tr>
                    <td>signature</td>
                    <td>
                      <code>{data.last_signature ?? ""}</code>
                    </td>
                  </tr>
                  <tr>
                    <td>started</td>
                    <td>{safeIso(data.started_at)}</td>
                  </tr>
                  <tr>
                    <td>updated</td>
                    <td>
                      {safeIso(data.updated_at)}
                      {staleMs != null ? <span style={{ marginLeft: 8 }}>({fmtMs(staleMs)} ago)</span> : null}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div>No heartbeat row found for <code>mother-brain</code>.</div>
            )}
          </div>

          <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700 }}>Last status snapshot</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  This is whatever Mother Brain wrote into <code>service_heartbeats.last_status_json</code>.
                </div>
              </div>
              <button
                onClick={() => {
                  setCopiedSnapshot(false);
                  void copyToClipboard(snapshotJson).then((ok) => setCopiedSnapshot(ok));
                }}
              >
                Copy JSON
              </button>
            </div>

            <pre style={{ marginTop: 10, maxHeight: 300, overflow: "auto", border: "1px solid #eee", padding: 10 }}>
              {snapshotJson}
            </pre>
            {copiedSnapshot ? <div>Copied.</div> : null}
          </div>
        
        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Goals health</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Mother Brain self-check suites (from snapshot). Use this as a quick pass/fail/stale signal.
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {goalsProxyEnabled ? (
                <button disabled={busy || goalsRunBusy} onClick={() => void runGoalsNow()}>
                  {goalsRunBusy ? "Running…" : "Run now"}
                </button>
              ) : null}
              {goalsSummary.overall ? (
                <span style={goalsBadgeStyle(goalsSummary.overall.status)}>{goalsSummary.overall.status}</span>
              ) : null}
            </div>
          </div>

          {!goalsSummary.overall ? (
            <div style={{ marginTop: 8 }}>
              <span>No goals health found in the latest snapshot.</span>{" "}
              <span style={{ opacity: 0.8 }}>
                Enable goals cadence in Mother Brain (e.g. <code>MOTHER_BRAIN_GOALS_EVERY_TICKS</code>).
              </span>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              {goalsProxyEnabled ? (
                <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.85 }}>
                  Tip: <code>Run now</code> uses the web-backend proxy to Mother Brain’s HTTP status server{goalsProxyBase ? (
                    <>
                      {" "}(<code>{goalsProxyBase}</code>)
                    </>
                  ) : null}.
                </div>
              ) : (
                <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.85 }}>
                  Tip: enable the optional Mother Brain HTTP server to get a <code>Run now</code> button (set <code>MOTHER_BRAIN_HTTP_PORT</code> on mother-brain and
                  <code>PW_MOTHER_BRAIN_HTTP_URL</code> (or the same host/port) on web-backend).
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                <div>
                  <span style={{ opacity: 0.8 }}>age</span>{" "}
                  <code>{goalsSummary.overall.ageSec == null ? "" : `${Math.round(goalsSummary.overall.ageSec)}s`}</code>
                </div>
                <div>
                  <span style={{ opacity: 0.8 }}>ok</span>{" "}
                  <code>{goalsSummary.overall.okCount == null ? "" : goalsSummary.overall.okCount}</code>
                </div>
                <div>
                  <span style={{ opacity: 0.8 }}>fail</span>{" "}
                  <code>{goalsSummary.overall.failCount == null ? "" : goalsSummary.overall.failCount}</code>
                </div>
                <div>
                  <span style={{ opacity: 0.8 }}>total</span>{" "}
                  <code>{goalsSummary.overall.totalCount == null ? "" : goalsSummary.overall.totalCount}</code>
                </div>
                {goalsSummary.overall.failingSuites.length ? (
                  <div>
                    <span style={{ opacity: 0.8 }}>failing suites</span>{" "}
                    <code>{goalsSummary.overall.failingSuites.join(", ")}</code>
                  </div>
                ) : null}
              </div>

              {goalsSummary.suites.length ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>Suites</div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left" }}>
                        <th style={{ padding: "6px 6px", borderBottom: "1px solid #eee" }}>suite</th>
                        <th style={{ padding: "6px 6px", borderBottom: "1px solid #eee" }}>status</th>
                        <th style={{ padding: "6px 6px", borderBottom: "1px solid #eee" }}>age</th>
                        <th style={{ padding: "6px 6px", borderBottom: "1px solid #eee" }}>ok</th>
                        <th style={{ padding: "6px 6px", borderBottom: "1px solid #eee" }}>fail</th>
                        <th style={{ padding: "6px 6px", borderBottom: "1px solid #eee" }}>total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goalsSummary.suites.map((s) => (
                        <tr key={s.suiteId}>
                          <td style={{ padding: "6px 6px", borderBottom: "1px solid #f5f5f5" }}>
                            <code>{s.suiteId}</code>
                          </td>
                          <td style={{ padding: "6px 6px", borderBottom: "1px solid #f5f5f5" }}>
                            <span style={goalsBadgeStyle(s.status)}>{s.status}</span>
                          </td>
                          <td style={{ padding: "6px 6px", borderBottom: "1px solid #f5f5f5" }}>
                            <code>{s.ageSec == null ? "" : `${Math.round(s.ageSec)}s`}</code>
                          </td>
                          <td style={{ padding: "6px 6px", borderBottom: "1px solid #f5f5f5" }}>
                            <code>{s.okCount == null ? "" : s.okCount}</code>
                          </td>
                          <td style={{ padding: "6px 6px", borderBottom: "1px solid #f5f5f5" }}>
                            <code>{s.failCount == null ? "" : s.failCount}</code>
                          </td>
                          <td style={{ padding: "6px 6px", borderBottom: "1px solid #f5f5f5" }}>
                            <code>{s.totalCount == null ? "" : s.totalCount}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                    Tip: suites come from <code>MOTHER_BRAIN_GOALS_PACKS</code> (or custom goals file/in-memory goals).
                  </div>
                </div>
              ) : null}

              {goalsSummary.overall.failingGoals.length ? (
                <div style={{ marginTop: 10 }}>
                  <details>
                    <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      Latest failing goals ({goalsSummary.overall.failingGoals.length})
                    </summary>
                    <div style={{ marginTop: 8 }}>
                      {goalsSummary.overall.failingGoals.map((f: any, idx: number) => (
                        <div
                          key={`${f.suiteId}:${f.id}:${idx}`}
                          style={{ border: "1px solid #eee", borderRadius: 10, padding: 10, marginBottom: 8 }}
                        >
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                            <code>{f.suiteId}</code>
                            <code style={{ fontWeight: 800 }}>{f.id}</code>
                            <code>{f.kind}</code>
                            {f.latencyMs != null ? (
                              <span style={{ opacity: 0.8 }}>
                                <code>{Math.round(f.latencyMs)}ms</code>
                              </span>
                            ) : null}
                          </div>
                          {f.error ? (
                            <div style={{ marginTop: 6 }}>
                              <span style={{ opacity: 0.8 }}>error</span> <code>{f.error}</code>
                            </div>
                          ) : null}
                          {f.details ? (
                            <pre
                              style={{
                                marginTop: 8,
                                maxHeight: 160,
                                overflow: "auto",
                                background: "#fafafa",
                                border: "1px solid #eee",
                                padding: 8,
                              }}
                            >
                              {JSON.stringify(f.details, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ) : null}

              <div style={{ marginTop: 10 }}>
                <details>
                  <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Goal report tail (JSONL)</summary>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                    Reads the last N lines from today’s <code>mother-brain-goals-&lt;suite&gt;-YYYY-MM-DD.jsonl</code> file (via web-backend).
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 10 }}>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span style={{ opacity: 0.8 }}>suite</span>
                      <select value={reportSuite} onChange={(e) => setReportSuite(String(e.target.value))}>
                        {suiteOptions.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span style={{ opacity: 0.8 }}>lines</span>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={reportLines}
                        onChange={(e) => setReportLines(Math.max(1, Math.min(500, Number(e.target.value) || 200)))}
                        style={{ width: 90 }}
                      />
                    </label>

                    <button disabled={reportBusy} onClick={() => void loadReportTail()}>
                      {reportBusy ? "Loading…" : "Load tail"}
                    </button>
                  </div>

                  {reportData ? (
                    reportData.ok ? (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <code>{reportData.filename}</code>

                          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <input type="checkbox" checked={reportOnlyFailures} onChange={(e) => setReportOnlyFailures(Boolean(e.target.checked))} />
                            <span>only failures</span>
                          </label>

                          {reportOnlyFailures ? (
                            <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <input
                                type="checkbox"
                                checked={reportLatestFailingRunOnly}
                                onChange={(e) => setReportLatestFailingRunOnly(Boolean(e.target.checked))}
                              />
                              <span>latest failing run</span>
                            </label>
                          ) : null}

                          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <input type="checkbox" checked={reportShowRaw} onChange={(e) => setReportShowRaw(Boolean(e.target.checked))} />
                            <span>show raw JSON</span>
                          </label>

                          <button
                            disabled={!reportData.lines || !Array.isArray(reportData.lines)}
                            onClick={async () => {
                              const failing = reportLatestFailingRunOnly
                                ? extractLatestFailingRunFromReportTail(reportData.suite, reportData.lines, 200)?.failures ?? []
                                : extractFailingLinesFromReportTail(reportData.suite, reportData.lines, 200);
                              const ok = await copyTextToClipboard(JSON.stringify(failing, null, 2));
                              setReportCopied(ok);
                              window.setTimeout(() => setReportCopied(false), 1200);
                            }}
                          >
                            Copy failing goals
                          </button>

                          {reportCopied ? <span style={{ opacity: 0.8 }}>copied</span> : null}
                        </div>

                        {reportOnlyFailures ? (
                          (() => {
                            const latest = reportLatestFailingRunOnly
                              ? extractLatestFailingRunFromReportTail(reportData.suite, reportData.lines, 200)
                              : null;
                            const payload = reportLatestFailingRunOnly
                              ? latest
                                ? { suite: latest.suite, ts: latest.ts, tick: latest.tick, failures: latest.failures }
                                : { suite: reportData.suite, ts: null, tick: null, failures: [] }
                              : extractFailingLinesFromReportTail(reportData.suite, reportData.lines, 200);

                            return (
                              <>
                                {reportLatestFailingRunOnly ? (
                                  <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>
                                    Latest failing run: <code>{latest?.ts ?? "(none)"}</code>
                                    {latest?.tick != null ? (
                                      <>
                                        {" "}tick <code>{latest.tick}</code>
                                      </>
                                    ) : null}
                                  </div>
                                ) : null}
                                <pre style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", padding: 10 }}>
                                  {prettyJson(payload)}
                                </pre>
                              </>
                            );
                          })()
                        ) : null}

                        {!reportOnlyFailures || reportShowRaw ? (
                          <details style={{ marginTop: 8 }}>
                            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Raw tail lines</summary>
                            <pre style={{ marginTop: 8, maxHeight: 260, overflow: "auto", border: "1px solid #eee", padding: 10 }}>
                              {prettyJson(reportData.lines)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, color: "#b00" }}>
                        <div style={{ fontWeight: 700 }}>{reportData.error}</div>
                        {reportData.detail ? <div style={{ fontSize: 12 }}>{reportData.detail}</div> : null}
                      </div>
                    )
                  ) : (
                    <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                      Tip: set <code>PW_MOTHER_BRAIN_GOALS_REPORT_DIR</code> or <code>PW_FILELOG</code> on web-backend to enable tail viewing.
                    </div>
                  )}                </details>
              </div>

              {goalsRunResult ? (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Latest Run-now result</summary>
                  <pre style={{ marginTop: 8, maxHeight: 240, overflow: "auto", border: "1px solid #eee", padding: 10 }}>
                    {prettyJson(goalsRunResult)}
                  </pre>
                </details>
              ) : null}
            </div>
          )}
        </div>


        </div>

        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Brain wave budget</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
            Top spawn-point counts used for wave budgeting (from Mother Brain snapshot).
          </div>

          {waveBudget?.kind === "ok" ? (
            <>
              <div style={{ marginBottom: 8 }}>
                <b>Total spawn points:</b> {waveBudget.total}
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>shard</th>
                    <th style={{ textAlign: "left" }}>type</th>
                    <th style={{ textAlign: "left" }}>count</th>
                  </tr>
                </thead>
                <tbody>
                  {waveBudget.top.map((r) => (
                    <tr key={`${r.shardId}:${r.type}`}>
                      <td>{r.shardId}</td>
                      <td>{r.type}</td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : waveBudget?.kind === "unavailable" ? (
            <div>
              No wave budget snapshot available (<code>{waveBudget.reason}</code>)
              {waveBudget.missingColumns?.length ? (
                <div style={{ marginTop: 6 }}>
                  Missing columns: <code>{waveBudget.missingColumns.join(", ")}</code>
                </div>
              ) : null}
            </div>
          ) : (
            <div>No wave budget snapshot available (feature disabled or DB missing).</div>
          )}

          <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Wave budget caps</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
              Optional caps from <code>spawn_wave_budgets</code>. Mother Brain can read these to compute remaining budget.
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <label>
                shard
                <input value={newShardId} onChange={(e) => setNewShardId(e.target.value)} style={{ marginLeft: 6 }} />
              </label>
              <label>
                type
                <input value={newType} onChange={(e) => setNewType(e.target.value)} style={{ marginLeft: 6 }} />
              </label>
              <label>
                cap
                <input value={newCap} onChange={(e) => setNewCap(e.target.value)} style={{ marginLeft: 6, width: 80 }} />
              </label>
              <label>
                policy
                <select value={newPolicy} onChange={(e) => setNewPolicy(e.target.value)} style={{ marginLeft: 6 }}>
                  <option value="hard">hard</option>
                  <option value="soft">soft</option>
                </select>
              </label>
              <button
                disabled={busy}
                onClick={() => {
                  const cap = toInt(newCap);
                  if (!newShardId.trim() || !newType.trim() || cap == null || cap < 0) {
                    setError("Please provide shard/type and a non-negative cap.");
                    return;
                  }
                  void handleUpsertCap(newShardId.trim(), newType.trim(), cap, newPolicy.trim() || "hard");
                }}
              >
                Add / Update
              </button>
            </div>

            {waveCaps.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>shard</th>
                    <th style={{ textAlign: "left" }}>type</th>
                    <th style={{ textAlign: "left" }}>cap</th>
                    <th style={{ textAlign: "left" }}>used</th>
                    <th style={{ textAlign: "left" }}>remaining</th>
                    <th style={{ textAlign: "left" }}>policy</th>
                    <th style={{ textAlign: "left" }}>updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {waveCaps.map((c) => {
                    const cap = toInt(c.cap) ?? 0;
                    const used = usageMap.get(`${c.shard_id}:${c.type}`) ?? 0;
                    const remaining = cap - used;
                    const over = remaining < 0 ? Math.abs(remaining) : 0;
                    return (
                      <tr key={`${c.shard_id}:${c.type}`}>
                        <td>{c.shard_id}</td>
                        <td>{c.type}</td>
                        <td>{cap}</td>
                        <td>{used}</td>
                        <td>
                          {over > 0 ? <span style={{ fontWeight: 700 }}>OVER by {over}</span> : Math.max(0, remaining)}
                        </td>
                        <td>{c.policy}</td>
                        <td>{safeIso(c.updated_at)}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => void handleUpsertCap(c.shard_id, c.type, cap, c.policy || "hard")}
                          >
                            Save
                          </button>
                          <button
                            style={{ marginLeft: 8 }}
                            disabled={busy}
                            onClick={() => void deleteCap({ shard_id: c.shard_id, type: c.type })}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ opacity: 0.8 }}>No caps defined yet.</div>
            )}
          </div>
        </div>

        <details style={{ marginTop: 14 }}>
          <summary>Raw response</summary>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 10 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>API response</div>
              <pre style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", padding: 10 }}>{apiJson}</pre>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Snapshot only</div>
              <pre style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eee", padding: 10 }}>{snapshotJson}</pre>
            </div>
          </div>
        </details>
      </AdminPanel>
    </AdminShell>
  );
}
