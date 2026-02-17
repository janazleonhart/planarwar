// web-frontend/pages/AdminHeartbeatsPage.tsx
//
// Service Heartbeats (Admin)
//
// Provides a quick overview of daemon health via public.service_heartbeats.
//
// Data source:
//   GET /api/admin/heartbeats

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { AdminShell, AdminPanel, AdminNotice } from "../components/admin/AdminUI";

type ServiceHeartbeatRow = {
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

type HeartbeatsResponse = {
  ok: boolean;
  heartbeats: ServiceHeartbeatRow[];
  warning?: string;
  detail?: string;
  error?: string;
};

const STALE_MS = 15_000;
const DEAD_MS = 60_000;

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

function safeIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function classifyAge(ageMs: number | null): "ok" | "stale" | "dead" | "unknown" {
  if (ageMs == null) return "unknown";
  if (ageMs > DEAD_MS) return "dead";
  if (ageMs > STALE_MS) return "stale";
  return "ok";
}

function statusLabel(s: "ok" | "stale" | "dead" | "unknown"): string {
  if (s === "ok") return "OK";
  if (s === "stale") return "STALE";
  if (s === "dead") return "DEAD";
  return "?";
}

function statusStyle(s: "ok" | "stale" | "dead" | "unknown"): { color: string; opacity?: number } {
  if (s === "ok") return { color: "#0a7" };
  if (s === "stale") return { color: "#b80" };
  if (s === "dead") return { color: "#777", opacity: 0.9 };
  return { color: "#666" };
}

export function AdminHeartbeatsPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rows, setRows] = useState<ServiceHeartbeatRow[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [everyMs, setEveryMs] = useState(5000);

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const load = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await api<HeartbeatsResponse>("/api/admin/heartbeats");
      if (!res.ok) {
        setRows([]);
        setError(res.error || "Heartbeats request failed.");
      } else {
        setRows(res.heartbeats ?? []);
        if (res.warning) setNotice(res.detail ? `${res.warning}: ${res.detail}` : res.warning);
      }
    } catch (e: any) {
      setRows([]);
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!autoRefresh) return;

    const ms = Math.max(1000, Math.min(120_000, Math.floor(everyMs)));
    timerRef.current = window.setInterval(() => void load(), ms);

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, everyMs]);

  const anyStale = useMemo(() => rows.some((r) => (msAgo(r.updated_at) ?? 0) > STALE_MS), [rows]);

  const rowsSorted = useMemo(() => {
    const withMeta = rows.map((r) => {
      const age = msAgo(r.updated_at);
      const status = classifyAge(age);
      return { r, age, status };
    });

    const rank = (s: string) => (s === "ok" ? 0 : s === "stale" ? 1 : s === "dead" ? 2 : 3);
    withMeta.sort((a, b) => {
      const ra = rank(a.status);
      const rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      const au = a.age ?? Number.POSITIVE_INFINITY;
      const bu = b.age ?? Number.POSITIVE_INFINITY;
      if (au !== bu) return au - bu;
      return a.r.service_name.localeCompare(b.r.service_name);
    });

    return withMeta;
  }, [rows]);

  return (
    <AdminShell title="Service Heartbeats" subtitle="Daemon health overview (from service_heartbeats).">
      {error ? <AdminNotice kind="error">{error}</AdminNotice> : null}
      {notice ? <AdminNotice kind="warn">{notice}</AdminNotice> : null}
      {anyStale ? (
        <AdminNotice kind="warn">
          Some services look stale (&gt; 30s since last update). They may be stopped, stuck, or writing to a different DB.
        </AdminNotice>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={load} disabled={busy} data-kind="primary">
          {busy ? "Refreshing…" : "Refresh"}
        </button>

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

      <AdminPanel title={`Heartbeats (${rows.length})`}>
        {rows.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--pw-border)" }}>
                  <th style={{ padding: "8px 6px" }}>service</th>
                  <th style={{ padding: "8px 6px" }}>status</th>
                  <th style={{ padding: "8px 6px" }}>ready</th>
                  <th style={{ padding: "8px 6px" }}>mode</th>
                  <th style={{ padding: "8px 6px" }}>version</th>
                  <th style={{ padding: "8px 6px" }}>last tick</th>
                  <th style={{ padding: "8px 6px" }}>age</th>
                  <th style={{ padding: "8px 6px" }}>updated</th>
                  <th style={{ padding: "8px 6px" }}>instance</th>
                </tr>
              </thead>
              <tbody>
                {rowsSorted.map(({ r, age, status }) => {
                  const stale = status === "stale";
                  const dead = status === "dead";
                  return (
                    <tr
                      key={r.service_name}
                      style={{
                        borderBottom: "1px solid var(--pw-border)",
                        opacity: dead ? 0.6 : 1,
                      }}
                    >
                      <td style={{ padding: "8px 6px" }}>
                        <code>{r.service_name}</code>
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <strong style={{ ...statusStyle(status), fontFamily: "monospace" }}>{statusLabel(status)}</strong>
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <strong style={{ color: r.ready ? "#0a7" : "#c33" }}>{r.ready ? "READY" : "NO"}</strong>
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <code>{r.mode ?? ""}</code>
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <code>{r.version ?? ""}</code>
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <code>{r.last_tick ?? ""}</code>
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <code>{age != null ? fmtMs(age) : ""}</code>
                      </td>
                      <td style={{ padding: "8px 6px", opacity: stale ? 1 : 0.85 }}>
                        {safeIso(r.updated_at)}
                        {age != null ? (
                          <span style={{ marginLeft: 8, opacity: 0.75 }}>
                            (updated)
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <code>{r.instance_id}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.8 }}>No heartbeat rows found.</div>
        )}
      </AdminPanel>
    </AdminShell>
  );
}
