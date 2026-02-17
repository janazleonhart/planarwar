// web-frontend/pages/AdminMotherBrainPage.tsx
//
// Mother Brain Status (v0)
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

export function AdminMotherBrainPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MotherBrainHeartbeat | null>(null);
  const [raw, setRaw] = useState<MotherBrainStatusResponse | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [everyMs, setEveryMs] = useState(2000);
  const timerRef = useRef<number | null>(null);

  const staleMs = useMemo(() => msAgo(data?.updated_at), [data?.updated_at]);
  const tickAgeMs = useMemo(() => msAgo(data?.last_tick_at), [data?.last_tick_at]);

  const isStale = (staleMs ?? 0) > 15_000;
  const isTickStale = (tickAgeMs ?? 0) > 15_000;

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<MotherBrainStatusResponse>("/api/admin/mother_brain/status");
      setRaw(res);
      if (!res.ok) {
        setData(null);
        setError(res.error || "Mother Brain status request failed.");
      } else {
        setData(res.status ?? null);
      }
    } catch (e: any) {
      setRaw(null);
      setData(null);
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
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
      // Avoid overlap if user is on a slow network.
      if (!busy) load();
    }, ms);

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, everyMs]);

  return (
    <AdminShell title="Mother Brain" subtitle="Service heartbeat + last status snapshot (polled from web-backend).">
      {error ? <AdminNotice kind="error">{error}</AdminNotice> : null}

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

        <AdminPanel title="Last status snapshot">
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
            {prettyJson(data?.last_status_json ?? null)}
          </pre>
        </AdminPanel>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Raw response</summary>
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
          {prettyJson(raw)}
        </pre>
      </details>
    </AdminShell>
  );
}
