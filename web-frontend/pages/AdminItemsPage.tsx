// web-frontend/pages/AdminItemsPage.tsx

import { useEffect, useMemo, useState } from "react";
import { explainAdminError, getAdminCaps, getAuthToken } from "../lib/api";
import { AdminNotice, AdminPanel, AdminShell, AdminTwoCol } from "../components/admin/AdminUI";

type AdminItem = {
  id: string;
  item_key: string;
  name: string;
  description: string;
  rarity: string;
  category: string;
  specialization_id?: string;
  icon_id?: string;
  max_stack: number;
  flagsText?: string;
  statsText?: string;
};

const authedFetch: typeof fetch = (input: any, init?: any) => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...(init ?? {}), headers });
};

function clampInt(n: any, def: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  const i = Math.trunc(v);
  return Math.max(min, Math.min(max, i));
}

export function AdminItemsPage() {
  const { canWrite } = getAdminCaps();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);

  const listLabel = useMemo(() => {
    if (total === null) return "";
    const start = offset + 1;
    const end = Math.min(offset + limit, total);
    return `Showing ${start}-${end} of ${total}`;
  }, [offset, limit, total]);

  const canNext = useMemo(() => {
    if (total === null) return items.length === limit;
    return offset + limit < total;
  }, [offset, limit, total, items.length]);

  const loadList = async (opts?: { resetOffset?: boolean }) => {
    try {
      setError(null);
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      qs.set("limit", String(limit));
      qs.set("offset", String(opts?.resetOffset ? 0 : offset));

      const res = await authedFetch(`/api/admin/items?${qs.toString()}`);
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(explainAdminError(data?.error || `HTTP ${res.status}`));
      }

      setItems(data.items || []);
      setTotal(typeof data.total === "number" ? data.total : null);

      if (opts?.resetOffset) setOffset(0);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const loadOne = async (id: string) => {
    try {
      setError(null);
      const res = await authedFetch(`/api/admin/items?q=${encodeURIComponent(id)}&limit=1&offset=0`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(explainAdminError(data?.error || `HTTP ${res.status}`));
      const it = (data.items || [])[0];
      if (!it) throw new Error("Item not found");
      setForm({
        ...it,
        flagsText: it.flags ? JSON.stringify(it.flags, null, 2) : "",
        statsText: it.stats ? JSON.stringify(it.stats, null, 2) : "",
      });
      setSelectedId(it.id);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  useEffect(() => {
    void loadList({ resetOffset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadOne(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const updateField = (k: keyof AdminItem, v: any) => {
    setForm((prev) => (prev ? { ...prev, [k]: v } : prev));
  };

  const startNew = () => {
    setSelectedId(null);
    setForm({
      id: "",
      item_key: "",
      name: "",
      description: "",
      rarity: "",
      category: "",
      specialization_id: "",
      icon_id: "",
      max_stack: 1,
      flagsText: "",
      statsText: "",
    });
  };

  const onSearch = async () => {
    await loadList({ resetOffset: true });
  };

  const onPrev = async () => {
    const next = Math.max(0, offset - limit);
    setOffset(next);
    await loadList();
  };

  const onNext = async () => {
    const next = offset + limit;
    setOffset(next);
    await loadList();
  };

  const handleSave = async () => {
    if (!form) return;
    try {
      setSaving(true);
      setError(null);

      // Parse JSON text fields (allow empty -> null)
      let flags: any = null;
      let stats: any = null;
      const flagsText = String(form.flagsText ?? "").trim();
      const statsText = String(form.statsText ?? "").trim();
      if (flagsText) flags = JSON.parse(flagsText);
      if (statsText) stats = JSON.parse(statsText);

      const payload = {
        ...form,
        item_key: form.item_key || form.id,
        flags,
        stats,
      };

      const res = await authedFetch(`/api/admin/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(explainAdminError(data?.error || `HTTP ${res.status}`));

      // Refresh list and select saved.
      await loadList();
      if (payload.id) setSelectedId(payload.id);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell
      title="Items"
      subtitle="DB-backed item editor (v0) • /api/admin/items"
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!canWrite ? <span style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>Read-only</span> : null}
          <button type="button" onClick={startNew} disabled={saving}>
            New
          </button>
        </div>
      }
    >
      {error ? <AdminNotice kind="error">Error: {error}</AdminNotice> : null}

      <AdminTwoCol
        leftWidth={380}
        left={
          <AdminPanel title="Items in DB" subtitle={listLabel || "Browse + search"}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
              <input
                style={{ flex: 1 }}
                placeholder="search id / name / key / category"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onSearch();
                }}
              />
              <button type="button" onClick={onSearch}>
                Search
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>
                Page size:
                <input
                  type="number"
                  style={{ width: 90, marginLeft: 6 }}
                  value={limit}
                  min={10}
                  max={500}
                  onChange={(e) => setLimit(clampInt(e.target.value, 50, 10, 500))}
                  onBlur={() => void onSearch()}
                />
              </label>

              <span style={{ flex: 1 }} />

              <button type="button" onClick={() => void onPrev()} disabled={offset === 0}>
                Prev
              </button>
              <button type="button" onClick={() => void onNext()} disabled={!canNext}>
                Next
              </button>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className="pw-card"
                    data-active={it.id === selectedId ? "true" : "false"}
                    onClick={() => setSelectedId(it.id)}
                    style={{ width: "100%", textAlign: "left" }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 13 }}>
                      {it.name || it.id} <code>({it.id})</code>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)", marginTop: 2 }}>
                      {it.rarity} • {it.category} • stack {it.max_stack}
                    </div>
                  </button>
                </li>
              ))}
              {items.length === 0 ? <li style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>No results.</li> : null}
            </ul>
          </AdminPanel>
        }
        right={
          <AdminPanel title="Editor" subtitle="Edit fields, then save">
            {form ? (
              <div style={{ display: "grid", gap: 10 }}>
                <label>
                  <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>ID</div>
                  <input style={{ width: "100%" }} value={form.id} onChange={(e) => updateField("id", e.target.value)} />
                </label>

                <label>
                  <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Item Key</div>
                  <input
                    style={{ width: "100%" }}
                    value={form.item_key}
                    onChange={(e) => updateField("item_key", e.target.value)}
                  />
                </label>

                <label>
                  <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Name</div>
                  <input style={{ width: "100%" }} value={form.name} onChange={(e) => updateField("name", e.target.value)} />
                </label>

                <label>
                  <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Description</div>
                  <textarea
                    style={{ width: "100%", height: 90 }}
                    value={form.description}
                    onChange={(e) => updateField("description", e.target.value)}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <label>
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Rarity</div>
                    <input style={{ width: "100%" }} value={form.rarity} onChange={(e) => updateField("rarity", e.target.value)} />
                  </label>

                  <label>
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Category</div>
                    <input style={{ width: "100%" }} value={form.category} onChange={(e) => updateField("category", e.target.value)} />
                  </label>

                  <label>
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Max Stack</div>
                    <input
                      type="number"
                      style={{ width: "100%" }}
                      value={form.max_stack}
                      onChange={(e) => updateField("max_stack", clampInt(e.target.value, 1, 1, 9999))}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label>
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Specialization ID</div>
                    <input
                      style={{ width: "100%" }}
                      value={form.specialization_id ?? ""}
                      onChange={(e) => updateField("specialization_id", e.target.value)}
                    />
                  </label>

                  <label>
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Icon ID</div>
                    <input
                      style={{ width: "100%" }}
                      value={form.icon_id ?? ""}
                      onChange={(e) => updateField("icon_id", e.target.value)}
                    />
                  </label>
                </div>

                <label>
                  <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Flags (JSON)</div>
                  <textarea
                    style={{ width: "100%", height: 110 }}
                    value={form.flagsText ?? ""}
                    onChange={(e) => updateField("flagsText", e.target.value)}
                  />
                </label>

                <label>
                  <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>Stats (JSON)</div>
                  <textarea
                    style={{ width: "100%", height: 110 }}
                    value={form.statsText ?? ""}
                    onChange={(e) => updateField("statsText", e.target.value)}
                  />
                </label>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  <button type="button" data-kind="primary" onClick={() => void handleSave()} disabled={!canWrite || saving}>
                    {saving ? "Saving..." : "Save Item"}
                  </button>
                  <button type="button" onClick={startNew} disabled={saving}>
                    Clear / New
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>Select an item or click “New”.</div>
            )}
          </AdminPanel>
        }
      />
    </AdminShell>
  );
}
