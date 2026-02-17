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
type BrainWaveBudgetSnapshot = { total: number; topByShardAndType: BrainWaveBudgetEntry[] };

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

function parseBrainWaveBudget(raw: unknown): null | {
  kind: "ok";
  total: number;
  top: Array<{ shardId: string; type: string; count: number }>;
} | {
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


export function AdminMotherBrainPage() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MotherBrainHeartbeat | null>(null);
  const [raw, setRaw] = useState<MotherBrainStatusResponse | null>(null);

  const snapshot = data?.last_status_json ?? null;

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
    } catch (e: any) {
      setRaw(null);
      setData(null);
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
      inFlightRef.current = false;
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

  const snapshotText = useMemo(() => prettyJson(data?.last_status_json ?? null), [data?.last_status_json]);
  const rawText = useMemo(() => prettyJson(raw), [raw]);

  const canCopy = typeof navigator !== "undefined";

  return (
    <AdminShell title="Mother Brain" subtitle="Service heartbeat + last status snapshot (polled from web-backend).">
      {error ? <AdminNotice kind="error">{error}</AdminNotice> : null}
      {notice ? <AdminNotice kind="warn">{notice}</AdminNotice> : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={load} disabled={busy} data-kind="primary">
          {busy ? "Refreshing…" : "Refresh"}
        </button>

        <a
          href="/api/admin/mother_brain/status"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, textDecoration: "underline", opacity: 0.85 }}
        >
          Open API response
        </a>

        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          Auto refresh
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          Every
          <input
            value={String(everyMs)}
            onChange={(e) => setEveryMs(Number(e.target.value || "0"))}
            style={{ width: 90 }}
          />
          ms
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
        <AdminPanel title="Heartbeat">
          {data ? (
            <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8 }}>
                <div style={{ opacity: 0.75 }}>service</div>
                <div>
                  <code>{data.service_name}</code>
                </div>

                <div style={{ opacity: 0.75 }}>instance</div>
                <div>
                  <code>{data.instance_id}</code>
                </div>

                <div style={{ opacity: 0.75 }}>host / pid</div>
                <div>
                  <code>
                    {data.host}:{data.pid}
                  </code>
                </div>

                <div style={{ opacity: 0.75 }}>version</div>
                <div>
                  <code>{data.version ?? ""}</code>
                </div>

                <div style={{ opacity: 0.75 }}>mode</div>
                <div>
                  <code>{data.mode ?? ""}</code>
                </div>

                <div style={{ opacity: 0.75 }}>ready</div>
                <div>
                  <strong style={{ color: data.ready ? "#0a7" : "#c33" }}>
                    {data.ready ? "READY" : "NOT READY"}
                  </strong>
                </div>

                <div style={{ opacity: 0.75 }}>last tick</div>
                <div>
                  <code>{data.last_tick ?? ""}</code>
                  {tickAgeMs != null ? (
                    <span style={{ marginLeft: 8, opacity: 0.75 }}>
                      ({fmtMs(tickAgeMs)} ago{isTickStale ? ", stale" : ""})
                    </span>
                  ) : null}
                </div>

                <div style={{ opacity: 0.75 }}>signature</div>
                <div>
                  <code>{data.last_signature ?? ""}</code>
                </div>

                <div style={{ opacity: 0.75 }}>started</div>
                <div>{safeIso(data.started_at)}</div>

                <div style={{ opacity: 0.75 }}>updated</div>
                <div>
                  {safeIso(data.updated_at)}
                  {staleMs != null ? (
                    <span style={{ marginLeft: 8, opacity: 0.75 }}>
                      ({fmtMs(staleMs)} ago{isStale ? ", stale" : ""})
                    </span>
                  ) : null}
                </div>
              </div>

              {(isStale || isTickStale) && (
                <AdminNotice kind="warn">
                  Heartbeat looks stale. If Mother Brain is running, it may be stuck, unable to write to DB, or
                  pointed at the wrong database.
                </AdminNotice>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              No heartbeat row found for <code>mother-brain</code>.
            </div>
          )}
        </AdminPanel>

        <AdminPanel
          title="Last status snapshot"
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            {canCopy ? (
              <button
                onClick={async () => {
                  const ok = await copyToClipboard(snapshotText);
                  setNotice(ok ? "Copied snapshot JSON to clipboard." : "Copy failed (clipboard not available).");
                }}
                disabled={!snapshotText}
                data-kind="secondary"
              >
                Copy JSON
              </button>
            ) : null}
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
            This is whatever Mother Brain wrote into <code>service_heartbeats.last_status_json</code>.
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#fafafa",
              border: "1px solid var(--pw-border)",
              borderRadius: 12,
              padding: 10,
              maxHeight: 520,
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {snapshotText}
          </pre>
        </AdminPanel>
      
        <AdminPanel
          title="Brain wave budget"
          subtitle="Top spawn-point counts used for wave budgeting (from Mother Brain snapshot)."
        >
          {(() => {
	  const budget = parseBrainWaveBudget(
	    (snapshot as any)?.brainWaveBudget ?? (snapshot as any)?.db?.brainWaveBudget,
	  );

  if (!budget) {
    return (
      <div className="text-sm text-slate-600">
        No wave budget snapshot available (feature disabled or DB missing).
      </div>
    );
  }

  if (budget.kind === "unavailable") {
    return (
      <div className="text-sm text-slate-600">
        <div>Wave budget unavailable: {budget.reason}.</div>
        {budget.missingColumns && budget.missingColumns.length > 0 ? (
          <div className="mt-1">
            Missing columns: <code>{budget.missingColumns.join(", ")}</code>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-sm">
      <div className="mb-1">
        Total spawn points: <b>{budget.total}</b>
      </div>

      {budget.top.length === 0 ? (
        <div className="text-slate-600">No spawn point rows returned.</div>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1 pr-2">shard</th>
              <th className="py-1 pr-2">type</th>
              <th className="py-1 pr-2">count</th>
            </tr>
          </thead>
          <tbody>
            {budget.top.map((row, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="py-1 pr-2">
                  <code>{row.shardId}</code>
                </td>
                <td className="py-1 pr-2">
                  <code>{row.type}</code>
                </td>
                <td className="py-1 pr-2">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
})()}

        </AdminPanel>

</div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Raw response</summary>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          {canCopy ? (
            <button
              onClick={async () => {
                const ok = await copyToClipboard(rawText);
                setNotice(ok ? "Copied raw response JSON to clipboard." : "Copy failed (clipboard not available).");
              }}
              disabled={!rawText}
              data-kind="secondary"
            >
              Copy raw
            </button>
          ) : null}
        </div>
        <pre
          style={{
            marginTop: 10,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "#fafafa",
            border: "1px solid var(--pw-border)",
            borderRadius: 12,
            padding: 10,
            fontSize: 12,
          }}
        >
          {rawText}
        </pre>
      </details>
    </AdminShell>
  );
}
