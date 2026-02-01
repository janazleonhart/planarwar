// web-frontend/pages/AdminVendorEconomyPage.tsx
//
// Admin editor for vendor_item_economy knobs (stock/restock/price multipliers).
// Polished UX: dirty tracking, bulk save, filters, and same-origin API via lib/api.ts.

import { useEffect, useMemo, useState } from "react";
import { api, getAdminCaps, getAuthToken } from "../lib/api";
import { ItemPicker } from "../components/ItemPicker";
import { AdminShell } from "../components/admin/AdminUI";

type VendorSummary = {
  id: string;
  name: string | null;
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

  const [nowMs, setNowMs] = useState(() => Date.now());

  const [limit, setLimit] = useState(500);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // UX polish controls
  const [qItem, setQItem] = useState("");
  const [onlyFinite, setOnlyFinite] = useState(false);
  const [onlyRestock, setOnlyRestock] = useState(false);
  const [onlyDirty, setOnlyDirty] = useState(false);

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

      // NOTE: this will reset edits for the page.
      // That’s OK for explicit refresh/paging/vendor change.
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
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
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

      return true;
    });
  }, [items, qItem, onlyFinite, onlyRestock, onlyDirty, edits]);

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
                <td colSpan={14} style={{ padding: 12, opacity: 0.7 }}>
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
