// web-frontend/pages/AdminVendorEconomyPage.tsx
//
// Admin editor for vendor_item_economy knobs (stock/restock/price multipliers).
// This is intentionally simple HTML so it matches the other dev admin pages.

import { useEffect, useMemo, useState } from "react";

// Keep consistent with other admin pages in this repo.
const ADMIN_API_BASE = "http://192.168.0.74:4000";

type VendorSummary = {
  id: string;
  name: string | null;
};

type VendorEconomyItem = {
  vendor_item_id: number;
  vendor_id: string;
  vendor_name: string | null;
  item_id: string;
  base_price_gold: number;

  stock: number | null;
  stock_max: number | null;
  last_restock_ts: string | null;

  restock_per_hour: number | null;
  restock_every_sec: number | null;
  restock_amount: number | null;
  price_min_mult: number | null;
  price_max_mult: number | null;
};

type ItemsResponse = {
  ok: boolean;
  vendorId: string;
  total: number;
  limit: number;
  offset: number;
  items: VendorEconomyItem[];
  error?: string;
};

type UpdateResponse = {
  ok: boolean;
  vendorItemId: number;
  applied?: any;
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

export function AdminVendorEconomyPage() {
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [vendorId, setVendorId] = useState<string>("");
  const [items, setItems] = useState<VendorEconomyItem[]>([]);
  const [edits, setEdits] = useState<Record<number, EditRow>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [limit, setLimit] = useState(500);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  async function loadVendors() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/vendor_economy/vendors`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
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
    return `${ADMIN_API_BASE}/api/admin/vendor_economy/items?${q.toString()}`;
  }, [vendorId, limit, offset]);

  function seedEdits(rows: VendorEconomyItem[]) {
    const next: Record<number, EditRow> = {};
    for (const r of rows) {
      next[r.vendor_item_id] = {
        stockMax: numStr(r.stock_max ?? 50),
        restockEverySec: numStr(r.restock_every_sec ?? 0),
        restockAmount: numStr(r.restock_amount ?? 0),
        priceMinMult: numStr(r.price_min_mult ?? 0.85),
        priceMaxMult: numStr(r.price_max_mult ?? 1.5),
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
      const res = await fetch(itemsUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as ItemsResponse;
      if (!data?.ok) throw new Error(data?.error || "Unknown error");
      setItems(data.items || []);
      setTotal(Number(data.total || 0));
      seedEdits(data.items || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function saveRow(vendorItemId: number) {
    const e = edits[vendorItemId];
    if (!e) return;

    setBusy(true);
    setNotice(null);
    setError(null);

    try {
      const payload = {
        stockMax: e.stockMax.trim() === "" ? null : Number(e.stockMax),
        restockEverySec: e.restockEverySec.trim() === "" ? null : Number(e.restockEverySec),
        restockAmount: e.restockAmount.trim() === "" ? null : Number(e.restockAmount),
        priceMinMult: e.priceMinMult.trim() === "" ? null : Number(e.priceMinMult),
        priceMaxMult: e.priceMaxMult.trim() === "" ? null : Number(e.priceMaxMult),
        resetStock: Boolean(e.resetStock),
      };

      const res = await fetch(`${ADMIN_API_BASE}/api/admin/vendor_economy/items/${vendorItemId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as UpdateResponse;
      if (!data?.ok) throw new Error(data?.error || "Unknown error");

      setNotice(`Saved vendor_item_id=${vendorItemId}`);
      // Reload to reflect DB clamps / derived per-hour.
      await loadItems();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Vendor Economy Config</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Vendor
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={busy} style={{ minWidth: 280 }}>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name ? `${v.name} (${v.id})` : v.id}
              </option>
            ))}
            {vendors.length === 0 && <option value="">(no vendors)</option>}
          </select>
        </label>

        <button onClick={() => loadItems()} disabled={busy || !vendorId}>Refresh</button>

        <span style={{ marginLeft: "auto" }}>
          <a href="/" style={{ marginRight: 12 }}>Back</a>
          <a href="/admin/vendor_audit">Audit Viewer</a>
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Limit
          <input
            type="number"
            value={limit}
            min={1}
            max={5000}
            onChange={(e) => { setOffset(0); setLimit(Math.max(1, Math.min(5000, Number(e.target.value) || 500))); }}
            style={{ width: 110 }}
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
              <th>rowId</th>
              <th>item</th>
              <th>base</th>
              <th>stock</th>
              <th>stockMax</th>
              <th>restockEverySec</th>
              <th>restockAmount</th>
              <th>priceMinMult</th>
              <th>priceMaxMult</th>
              <th>lastRestock</th>
              <th>resetStock</th>
              <th>save</th>
            </tr>
          </thead>

          <tbody>
            {items.map((r) => {
              const e = edits[r.vendor_item_id];
              const stockLabel =
                r.stock === null || r.stock_max === null ? "∞" : `${r.stock}/${r.stock_max}`;

              return (
                <tr key={r.vendor_item_id} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                  <td style={{ whiteSpace: "nowrap" }}>{r.vendor_item_id}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.item_id}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.base_price_gold}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{stockLabel}</td>

                  <td>
                    <input
                      value={e?.stockMax ?? ""}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [r.vendor_item_id]: { ...(prev[r.vendor_item_id] ?? e), stockMax: ev.target.value } }))}
                      style={{ width: 90 }}
                    />
                  </td>

                  <td>
                    <input
                      value={e?.restockEverySec ?? ""}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [r.vendor_item_id]: { ...(prev[r.vendor_item_id] ?? e), restockEverySec: ev.target.value } }))}
                      style={{ width: 120 }}
                    />
                  </td>

                  <td>
                    <input
                      value={e?.restockAmount ?? ""}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [r.vendor_item_id]: { ...(prev[r.vendor_item_id] ?? e), restockAmount: ev.target.value } }))}
                      style={{ width: 120 }}
                    />
                  </td>

                  <td>
                    <input
                      value={e?.priceMinMult ?? ""}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [r.vendor_item_id]: { ...(prev[r.vendor_item_id] ?? e), priceMinMult: ev.target.value } }))}
                      style={{ width: 110 }}
                    />
                  </td>

                  <td>
                    <input
                      value={e?.priceMaxMult ?? ""}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [r.vendor_item_id]: { ...(prev[r.vendor_item_id] ?? e), priceMaxMult: ev.target.value } }))}
                      style={{ width: 110 }}
                    />
                  </td>

                  <td style={{ whiteSpace: "nowrap" }}>{r.last_restock_ts ?? ""}</td>

                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(e?.resetStock)}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [r.vendor_item_id]: { ...(prev[r.vendor_item_id] ?? e), resetStock: ev.target.checked } }))}
                    />
                  </td>

                  <td>
                    <button onClick={() => saveRow(r.vendor_item_id)} disabled={busy}>Save</button>
                  </td>
                </tr>
              );
            })}

            {items.length === 0 && (
              <tr>
                <td colSpan={12} style={{ padding: 12, opacity: 0.7 }}>
                  No vendor items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
        Backend: <code>/api/admin/vendor_economy</code> · Edits are clamped server-side to keep configs safe.
      </div>
    </div>
  );
}
