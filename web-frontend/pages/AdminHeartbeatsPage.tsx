// web-frontend/pages/AdminHeartbeatsPage.tsx
//
// Service Heartbeats (Admin)
//
// Provides a quick overview of daemon health via public.service_heartbeats.
//
// Data source:
//   GET /api/admin/heartbeats

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  restart?: { enabled: boolean; denyServices?: string[]; detail?: string };
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

function safePrettyJson(v: unknown): string {
  if (v == null) return "null";
  try {
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      }
      return v;
    }
    return JSON.stringify(v, null, 2);
  } catch {
    return typeof v === "string" ? v : String(v);
  }
}

export function AdminHeartbeatsPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rows, setRows] = useState<ServiceHeartbeatRow[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [everyMs, setEveryMs] = useState(5000);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restartingService, setRestartingService] = useState<string | null>(null);
  const [restartEnabled, setRestartEnabled] = useState(false);
  const [restartDenyServices, setRestartDenyServices] = useState<string[]>(["web-backend"]);
  const [restartDetail, setRestartDetail] = useState<string | null>(null);

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
        setRestartEnabled(false);
        setRestartDenyServices(["web-backend"]);
        setRestartDetail(null);
        setError(res.error || "Heartbeats request failed.");
      } else {
        setRows(res.heartbeats ?? []);
        setRestartEnabled(Boolean(res.restart?.enabled));
        setRestartDenyServices(res.restart?.denyServices ?? ["web-backend"]);
        setRestartDetail(res.restart?.detail ?? null);
        if (res.warning) setNotice(res.detail ? `${res.warning}: ${res.detail}` : res.warning);
      }
    } catch (e: any) {
      setRows([]);
      setRestartEnabled(false);
      setRestartDenyServices(["web-backend"]);
      setRestartDetail(null);
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  const restartService = async (serviceName: string) => {
    if (!serviceName) return;
    const deny = new Set(restartDenyServices);
    if (!restartEnabled) { setNotice(restartDetail || "Restart disabled (dev only)." ); return; }
    if (deny.has(serviceName)) { setNotice(`Restart disabled for ${serviceName}.`); return; }
    if (restartingService) return; // single-flight
    setRestartingService(serviceName);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/admin/heartbeats/restart`, {
        method: "POST",
        body: JSON.stringify({ serviceName }),
      });
      if (!res?.ok) throw new Error(res?.error || "Restart request failed");
      setNotice(`Restart signal sent to ${serviceName}.`);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setRestartingService(null);
      // Refresh list so UI reflects any change (or simply confirms still running).
      void load();
    }
  };
  const restartMany = async (serviceNames: string[]) => {
    const names = Array.from(new Set(serviceNames.map((s) => String(s || "").trim()).filter(Boolean)));
    if (!names.length) return;

    if (!restartEnabled) {
      setNotice(restartDetail || "Restart disabled (dev only).");
      return;
    }

    const deny = new Set(restartDenyServices);
    const filtered = names.filter((n) => !deny.has(n));

    if (!filtered.length) {
      setNotice("No restartable services selected.");
      return;
    }

    const msg =
      filtered.length === 1
        ? `Send restart signal to ${filtered[0]}?`
        : `Send restart signal to ${filtered.length} services?\n\n${filtered.join("\n")}`;
    if (!window.confirm(msg)) return;

    if (restartingService) return; // single-flight
    setRestartingService("__many__");
    setError(null);
    setNotice(null);

    try {
      const res = await api<{
        ok: boolean;
        error?: string;
        restarted?: string[];
        results?: Array<{ serviceName: string; ok: boolean; error?: string; detail?: string }>;
      }>(`/api/admin/heartbeats/restart_many`, {
        method: "POST",
        body: JSON.stringify({ serviceNames: filtered }),
      });

      if (!res?.ok) throw new Error(res?.error || "Restart request failed");

      const restarted = res.restarted ?? [];
      const failed = (res.results ?? []).filter((r) => !r.ok);
      if (failed.length) {
        setNotice(
          `Restart sent to: ${restarted.join(", ") || "(none)"}; failed: ${failed
            .map((f) => `${f.serviceName} (${f.error || "error"})`)
            .join(", ")}`,
        );
      } else {
        setNotice(`Restart signal sent to: ${restarted.join(", ")}`);
      }
    } catch (e: any) {
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setRestartingService(null);
      void load();
    }
  };

  const restartAllVisible = () => {
    const names = rows.map((r) => r.service_name).filter(Boolean);
    void restartMany(names);
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
          Some services look stale (&gt; {Math.round(STALE_MS / 1000)}s since last update). They may be stopped, stuck,
          or writing to a different DB.
        </AdminNotice>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={load} disabled={busy} data-kind="primary">
          {busy ? "Refreshing…" : "Refresh"}
        </button>

        {restartEnabled ? (
          <button
            onClick={restartAllVisible}
            disabled={busy || restartingService != null || rows.length === 0}
            title="Send SIGTERM to all restartable services shown in the table (dev only)"
          >
            Restart all (safe)
          </button>
        ) : null}


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
                  <th style={{ padding: "8px 6px" }}></th>
                </tr>
              </thead>
              <tbody>
                {rowsSorted.map(({ r, age, status }) => {
                  const stale = status === "stale";
                  const dead = status === "dead";
                  const isOpen = expanded === r.service_name;
                  const deny = new Set(restartDenyServices);
                  const canRestart = restartEnabled && !deny.has(r.service_name);

                  return (
                    <Fragment key={r.service_name}>
                      <tr
                        style={{
                          borderBottom: isOpen ? "none" : "1px solid var(--pw-border)",
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
                          {age != null ? <span style={{ marginLeft: 8, opacity: 0.75 }}>(updated)</span> : null}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <code>{r.instance_id}</code>
                        </td>
                        <td style={{ padding: "8px 6px", textAlign: "right" }}>
                          <button
                            className="pw-btn"
                            onClick={() => setExpanded((cur) => (cur === r.service_name ? null : r.service_name))}
                            style={{ padding: "2px 8px" }}
                          >
                            {isOpen ? "Hide" : "Details"}
                          </button>

                          <button
                            onClick={() => restartService(r.service_name)}
                            disabled={!canRestart || restartingService === r.service_name}
                            style={{ padding: "2px 8px", marginLeft: 8 }}
                          title={canRestart ? "Dev only: sends SIGTERM to the daemon PID (requires PW_ADMIN_ALLOW_RESTART=true)." : (restartDetail || "Restart disabled.")}
                          >
                          {restartingService === r.service_name ? "Restarting…" : canRestart ? "Restart" : "Restart (disabled)"}
                          </button>
                        </td>
                      </tr>

                      {isOpen ? (
                        <tr style={{ borderBottom: "1px solid var(--pw-border)" }}>
                          <td colSpan={10} style={{ padding: "10px 6px" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                              <div>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>Last status snapshot</div>
                                <pre
                                  style={{
                                    margin: 0,
                                    padding: 10,
                                    border: "1px solid var(--pw-border)",
                                    borderRadius: 10,
                                    background: "rgba(0,0,0,0.03)",
                                    maxHeight: 360,
                                    overflow: "auto",
                                    fontSize: 12,
                                  }}
                                >
                                  {safePrettyJson(r.last_status_json)}
                                </pre>
                              </div>

                              <div>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>Raw fields</div>
                                <pre
                                  style={{
                                    margin: 0,
                                    padding: 10,
                                    border: "1px solid var(--pw-border)",
                                    borderRadius: 10,
                                    background: "rgba(0,0,0,0.03)",
                                    maxHeight: 360,
                                    overflow: "auto",
                                    fontSize: 12,
                                  }}
                                >
                                  {safePrettyJson({
                                    service_name: r.service_name,
                                    instance_id: r.instance_id,
                                    host: r.host,
                                    pid: r.pid,
                                    version: r.version,
                                    mode: r.mode,
                                    ready: r.ready,
                                    last_tick: r.last_tick,
                                    last_signature: r.last_signature,
                                    started_at: r.started_at,
                                    last_tick_at: r.last_tick_at,
                                    updated_at: r.updated_at,
                                  })}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
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
