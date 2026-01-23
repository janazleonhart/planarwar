// web-frontend/pages/AdminVendorAuditPage.tsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

type VendorAuditRow = {
  ts: string;
  shard_id: string | null;
  actor_char_id: string | null;
  actor_char_name: string | null;
  vendor_id: string;
  vendor_name: string | null;
  action: string;
  item_id: string | null;
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
  error?: string;
};

export function AdminVendorAuditPage() {
  const [rows, setRows] = useState<VendorAuditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const queryPath = useMemo(() => {
    const q = new URLSearchParams();
    q.set("limit", String(limit));
    q.set("offset", String(offset));
    if (vendorId.trim()) q.set("vendorId", vendorId.trim());
    if (actorCharId.trim()) q.set("actorCharId", actorCharId.trim());
    if (actorCharName.trim()) q.set("actorCharName", actorCharName.trim());
    if (action.trim()) q.set("action", action.trim());
    if (result.trim()) q.set("result", result.trim());
    if (itemId.trim()) q.set("itemId", itemId.trim());
    if (since.trim()) q.set("since", since.trim());
    if (until.trim()) q.set("until", until.trim());

    return `/api/admin/vendor_audit?${q.toString()}`;
  }, [vendorId, actorCharId, actorCharName, action, result, itemId, since, until, limit, offset]);

  async function load() {
    setBusy(true);
    setError(null);
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

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Vendor Audit Viewer</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          placeholder="vendorId"
          value={vendorId}
          onChange={(e) => {
            setOffset(0);
            setVendorId(e.target.value);
          }}
        />
        <input
          placeholder="actorCharId"
          value={actorCharId}
          onChange={(e) => {
            setOffset(0);
            setActorCharId(e.target.value);
          }}
        />
        <input
          placeholder="actorCharName contains"
          value={actorCharName}
          onChange={(e) => {
            setOffset(0);
            setActorCharName(e.target.value);
          }}
        />
        <input
          placeholder="action (buy|sell)"
          value={action}
          onChange={(e) => {
            setOffset(0);
            setAction(e.target.value);
          }}
        />
        <input
          placeholder="result (ok|deny|error)"
          value={result}
          onChange={(e) => {
            setOffset(0);
            setResult(e.target.value);
          }}
        />
        <input
          placeholder="itemId"
          value={itemId}
          onChange={(e) => {
            setOffset(0);
            setItemId(e.target.value);
          }}
        />
        <input
          placeholder="since (ISO)"
          value={since}
          onChange={(e) => {
            setOffset(0);
            setSince(e.target.value);
          }}
          style={{ minWidth: 220 }}
        />
        <input
          placeholder="until (ISO)"
          value={until}
          onChange={(e) => {
            setOffset(0);
            setUntil(e.target.value);
          }}
          style={{ minWidth: 220 }}
        />
        <button onClick={() => load()} disabled={busy}>
          Refresh
        </button>

        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/admin/vendor_economy">Economy Config</a>
          <a href="/">Back</a>
        </span>
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
              setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 200)));
            }}
            style={{ width: 90 }}
          />
        </label>

        <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={busy || offset <= 0}>
          Prev
        </button>
        <button onClick={() => setOffset(Math.min((pageCount - 1) * limit, offset + limit))} disabled={busy || page >= pageCount}>
          Next
        </button>

        <span style={{ opacity: 0.8 }}>
          page {page}/{pageCount} · total {total}
        </span>
      </div>

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
              <th>ts</th>
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
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                <td style={{ whiteSpace: "nowrap" }}>{r.ts}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.shard_id || ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.actor_char_name || r.actor_char_id || ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.vendor_name || r.vendor_id}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.action}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.item_id || ""}</td>
                <td>{r.quantity ?? ""}</td>
                <td>{r.unit_price_gold ?? ""}</td>
                <td>{r.total_gold ?? ""}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.gold_before ?? ""} → {r.gold_after ?? ""}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <b>{r.result}</b>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{r.reason || ""}</td>
                <td style={{ maxWidth: 360 }}>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.meta ? JSON.stringify(r.meta, null, 2) : ""}</pre>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} style={{ padding: 12, opacity: 0.7 }}>
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
        Endpoint: <code>/api/admin/vendor_audit</code> (web-backend). Filters are optional; timestamps accept ISO strings.
      </div>
    </div>
  );
}
