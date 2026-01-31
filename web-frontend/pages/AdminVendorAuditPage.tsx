// web-frontend/pages/AdminVendorAuditPage.tsx
//
// Vendor Audit Viewer (v1.2)
// - Same-origin /api via lib/api.ts (Vite proxies /api -> web-backend in dev)
// - Filter presets (buy/sell/deny/error), clear filters
// - Copy row JSON to clipboard
// - Pagination + stable, readable table
// - CSV export via streaming endpoint (server-side, handles very large datasets)

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { getAuthToken } from "../lib/api";

type VendorAuditRow = {
  ts: string;
  shard_id: string | null;
  actor_char_id: string | null;
  actor_char_name: string | null;
  vendor_id: string;
  vendor_name: string | null;
  action: string;
  item_id: string | null;
  item_name: string | null;
  item_rarity: string | null;
  quantity: number | null;
  unit_price_gold: number | null;
  total_gold: number | null;
  gold_before: number | null;
  gold_after: number | null;
  result: string;
  reason: string | null;
  meta: any | null;
};

type VendorAuditResponse = {
  ok: boolean;
  rows: VendorAuditRow[];
  total: number;
  limit?: number;
  offset?: number;
  error?: string;
};

type VendorAuditFilters = {
  vendorId: string;
  actorCharId: string;
  actorCharName: string;
  action: string;
  result: string;
  itemId: string;
  since: string;
  until: string;
};

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return Math.floor(n);
}

function fmtNum(n: number | null | undefined) {
  if (n == null) return "";
  return String(n);
}

function safeLocalTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-10000px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function buildVendorAuditQuery(filters: VendorAuditFilters, limit: number, offset: number) {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  q.set("offset", String(offset));

  const add = (k: keyof VendorAuditFilters) => {
    const t = filters[k].trim();
    if (t) q.set(k, t);
  };

  add("vendorId");
  add("actorCharId");
  add("actorCharName");
  add("action");
  add("result");
  add("itemId");
  add("since");
  add("until");

  return `/api/admin/vendor_audit?${q.toString()}`;
}

function buildVendorAuditCsvUrl(filters: VendorAuditFilters, opts?: { maxRows?: number; chunk?: number }) {
  const q = new URLSearchParams();

  const add = (k: keyof VendorAuditFilters) => {
    const t = filters[k].trim();
    if (t) q.set(k, t);
  };

  add("vendorId");
  add("actorCharId");
  add("actorCharName");
  add("action");
  add("result");
  add("itemId");
  add("since");
  add("until");

  if (opts?.maxRows != null) q.set("maxRows", String(opts.maxRows));
  if (opts?.chunk != null) q.set("chunk", String(opts.chunk));

  const qs = q.toString();
  return qs ? `/api/admin/vendor_audit/csv?${qs}` : `/api/admin/vendor_audit/csv`;
}


const authedFetch: typeof fetch = (input: any, init?: any) => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...(init ?? {}), headers });
};

export function AdminVendorAuditPage() {
  const [rows, setRows] = useState<VendorAuditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters
  const [vendorId, setVendorId] = useState("");
  const [actorCharId, setActorCharId] = useState("");
  const [actorCharName, setActorCharName] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [itemId, setItemId] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  // Paging
  const [limit, setLimit] = useState(200);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // CSV options (server-side)
  const [csvMaxRows, setCsvMaxRows] = useState(2_000_000);

  const filters = useMemo<VendorAuditFilters>(
    () => ({
      vendorId,
      actorCharId,
      actorCharName,
      action,
      result,
      itemId,
      since,
      until,
    }),
    [vendorId, actorCharId, actorCharName, action, result, itemId, since, until]
  );

  const queryPath = useMemo(() => buildVendorAuditQuery(filters, limit, offset), [filters, limit, offset]);

  async function load() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api<VendorAuditResponse>(queryPath);
      if (!data?.ok) throw new Error(data?.error || "Unknown error");
      setRows(data.rows || []);
      setTotal(Number(data.total || 0));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryPath]);

  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  const resetFilters = () => {
    setVendorId("");
    setActorCharId("");
    setActorCharName("");
    setAction("");
    setResult("");
    setItemId("");
    setSince("");
    setUntil("");
    setOffset(0);
  };

  const preset = (p: { action?: string; result?: string }) => {
    if (p.action !== undefined) setAction(p.action);
    if (p.result !== undefined) setResult(p.result);
    setOffset(0);
  };

  const copyRow = async (r: VendorAuditRow) => {
    const ok = await copyToClipboard(JSON.stringify(r, null, 2));
    setNotice(ok ? "Copied row JSON." : "Copy failed (clipboard blocked).");
    setTimeout(() => setNotice(null), 1500);
  };

  const exportCsvServer = () => {
    const maxRows = clampInt(Number(csvMaxRows) || 2_000_000, 1, 5_000_000);
    const url = buildVendorAuditCsvUrl(filters, { maxRows, chunk: 1000 });

    // Prefer new tab (keeps viewer open); fall back if popup blocked.
    const w = window.open(url, "_blank");
    if (!w) window.location.assign(url);

    setNotice("CSV export started (server streaming).");
    setTimeout(() => setNotice(null), 2000);
  };

  const anyBusy = busy;

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Vendor Audit Viewer</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <button onClick={() => preset({ action: "buy" })} disabled={anyBusy}>
          Buy
        </button>
        <button onClick={() => preset({ action: "sell" })} disabled={anyBusy}>
          Sell
        </button>
        <button onClick={() => preset({ result: "deny" })} disabled={anyBusy}>
          Deny
        </button>
        <button onClick={() => preset({ result: "error" })} disabled={anyBusy}>
          Error
        </button>
        <button onClick={() => preset({ action: "", result: "ok" })} disabled={anyBusy}>
          OK
        </button>
        <button onClick={resetFilters} disabled={anyBusy}>
          Clear
        </button>

        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }} title="Hard cap for CSV export (server)">
            CSV maxRows
            <input
              type="number"
              value={csvMaxRows}
              min={1}
              max={5_000_000}
              onChange={(e) => setCsvMaxRows(clampInt(Number(e.target.value) || 2_000_000, 1, 5_000_000))}
              style={{ width: 120 }}
              disabled={anyBusy}
            />
          </label>

          <button onClick={exportCsvServer} disabled={anyBusy} title="Export ALL rows matching current filters (server streamed)">
            Export CSV (server)
          </button>
        </span>

        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/admin/vendor_economy">Economy Config</a>
          <a href="/">Back</a>
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input
          placeholder="vendorId"
          value={vendorId}
          onChange={(e) => {
            setOffset(0);
            setVendorId(e.target.value);
          }}
          disabled={anyBusy}
        />
        <input
          placeholder="actorCharId"
          value={actorCharId}
          onChange={(e) => {
            setOffset(0);
            setActorCharId(e.target.value);
          }}
          disabled={anyBusy}
        />
        <input
          placeholder="actorCharName contains"
          value={actorCharName}
          onChange={(e) => {
            setOffset(0);
            setActorCharName(e.target.value);
          }}
          disabled={anyBusy}
        />
        <input
          placeholder="action (buy|sell)"
          value={action}
          onChange={(e) => {
            setOffset(0);
            setAction(e.target.value);
          }}
          style={{ width: 160 }}
          disabled={anyBusy}
        />
        <input
          placeholder="result (ok|deny|error)"
          value={result}
          onChange={(e) => {
            setOffset(0);
            setResult(e.target.value);
          }}
          style={{ width: 180 }}
          disabled={anyBusy}
        />
        <input
          placeholder="itemId"
          value={itemId}
          onChange={(e) => {
            setOffset(0);
            setItemId(e.target.value);
          }}
          disabled={anyBusy}
        />
        <input
          placeholder="since (ISO or timestamptz)"
          value={since}
          onChange={(e) => {
            setOffset(0);
            setSince(e.target.value);
          }}
          style={{ minWidth: 240 }}
          disabled={anyBusy}
        />
        <input
          placeholder="until (ISO or timestamptz)"
          value={until}
          onChange={(e) => {
            setOffset(0);
            setUntil(e.target.value);
          }}
          style={{ minWidth: 240 }}
          disabled={anyBusy}
        />
        <button onClick={() => load()} disabled={anyBusy}>
          Refresh
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Limit
          <input
            type="number"
            value={limit}
            min={1}
            max={1000}
            onChange={(e) => {
              setOffset(0);
              setLimit(clampInt(Number(e.target.value) || 200, 1, 1000));
            }}
            style={{ width: 90 }}
            disabled={anyBusy}
          />
        </label>

        <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={anyBusy || offset <= 0}>
          Prev
        </button>
        <button
          onClick={() => setOffset(Math.min((pageCount - 1) * limit, offset + limit))}
          disabled={anyBusy || page >= pageCount}
        >
          Next
        </button>

        <span style={{ opacity: 0.8 }}>
          page {page}/{pageCount} · total {total} · showing {rows.length}
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

      {busy && <div style={{ marginBottom: 8 }}>Loading…</div>}

      <div style={{ overflowX: "auto" }}>
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th>time</th>
              <th>shard</th>
              <th>actor</th>
              <th>vendor</th>
              <th>action</th>
              <th>item</th>
              <th>qty</th>
              <th>unit</th>
              <th>total</th>
              <th>gold</th>
              <th>result</th>
              <th>reason</th>
              <th>meta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const resultColor = r.result === "ok" ? "#0a7" : r.result === "deny" ? "#d07a00" : "#d00";
              return (
                <tr key={i} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                  <td style={{ whiteSpace: "nowrap" }} title={r.ts}>
                    {safeLocalTime(r.ts)}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.shard_id || ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.actor_char_name || r.actor_char_id || ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.vendor_name || r.vendor_id}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.action}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 700 }}>{r.item_name || r.item_id || ""}</div>
                    {r.item_name && r.item_id ? (
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{r.item_id}</div>
                    ) : null}
                  </td>
                  <td>{fmtNum(r.quantity)}</td>
                  <td>{fmtNum(r.unit_price_gold)}</td>
                  <td>{fmtNum(r.total_gold)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {fmtNum(r.gold_before)} → {fmtNum(r.gold_after)}
                  </td>
                  <td style={{ whiteSpace: "nowrap", color: resultColor, fontWeight: 700 }}>{r.result}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.reason || ""}</td>
                  <td style={{ maxWidth: 360 }}>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.meta ? JSON.stringify(r.meta, null, 2) : ""}</pre>
                  </td>
                  <td>
                    <button onClick={() => copyRow(r)} disabled={anyBusy}>
                      Copy
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} style={{ padding: 12, opacity: 0.7 }}>
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
        Endpoint: <code>/api/admin/vendor_audit</code> · CSV: <code>/api/admin/vendor_audit/csv</code> · Server orders newest-first (ts DESC).
      </div>
    </div>
  );
}