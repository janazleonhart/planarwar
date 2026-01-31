// web-frontend/pages/AdminItemsPage.tsx

import { useEffect, useMemo, useState } from "react";
import { explainAdminError, getAdminCaps, getAuthToken } from "../lib/api";

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
  const [error, setError] = useState<string | null>(null);

  // Search + paging (keeps list usable once items grow)
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const loadItems = async (qArg: string, limitArg: number, offsetArg: number) => {
    const qp = new URLSearchParams();
    if (qArg.trim()) qp.set("q", qArg.trim());
    qp.set("limit", String(limitArg));
    qp.set("offset", String(offsetArg));

    const res = await authedFetch(`/api/admin/items?${qp.toString()}`);
    const data: { ok: boolean; items: AdminItem[]; error?: string } = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || explainAdminError(String(res.status)));
    setItems(data.items || []);
  };

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        await loadItems(q, limit, offset);
      } catch (err: any) {
        setError(err.message || String(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selecting an item, populate form
  useEffect(() => {
    if (!selectedId) {
      setForm(null);
      return;
    }
    const it = items.find((x) => x.id === selectedId);
    if (it) setForm({ ...it });
  }, [selectedId, items]);

  const startNew = () => {
    setSelectedId(null);
    setForm({
      id: "",
      item_key: "",
      name: "",
      description: "",
      rarity: "common",
      category: "misc",
      specialization_id: "",
      icon_id: "",
      max_stack: 1,
      flagsText: "",
      statsText: "",
    });
  };

  const updateField = <K extends keyof AdminItem>(key: K, value: AdminItem[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const onSearch = async () => {
    try {
      setError(null);
      setOffset(0);
      await loadItems(q, limit, 0);
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const onPrev = async () => {
    const next = Math.max(0, offset - limit);
    try {
      setError(null);
      setOffset(next);
      await loadItems(q, limit, next);
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const onNext = async () => {
    const next = offset + limit;
    try {
      setError(null);
      setOffset(next);
      await loadItems(q, limit, next);
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const canNext = useMemo(() => items.length === limit, [items.length, limit]);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);

    try {
      const payload = {
        ...form,
        id: String(form.id).trim(),
        item_key: String(form.item_key || form.id).trim(),
        max_stack: clampInt(form.max_stack, 1, 1, 9999),
      };

      const res = await authedFetch(`/api/admin/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let out: { ok?: boolean; error?: string } = {};
      try {
        out = await res.json();
      } catch {
        // ignore
      }

      if (!res.ok || out.ok === false) {
        throw new Error(out.error || explainAdminError(String(res.status)));
      }

      // Reload list respecting q/limit/offset
      await loadItems(q, limit, offset);

      if (!selectedId) setSelectedId(payload.id);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const listLabel = useMemo(() => {
    const from = offset + 1;
    const to = offset + items.length;
    if (items.length === 0) return "No items";
    return `Showing ${from}-${to}`;
  }, [items.length, offset]);

  return (
    <div style={{ padding: 16 }}>
      <h1>Item Editor (v0)</h1>

      {error && <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: list */}
        <div style={{ minWidth: 320 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Items in DB</strong>
            <button onClick={startNew}>New</button>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              style={{ flex: 1 }}
              placeholder="search id / name / key / category"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearch();
              }}
            />
            <button onClick={onSearch}>Search</button>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>{listLabel}</span>
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: 12, opacity: 0.85 }}>
              Page size:
              <input
                type="number"
                style={{ width: 70, marginLeft: 6 }}
                value={limit}
                min={10}
                max={500}
                onChange={(e) => setLimit(clampInt(e.target.value, 50, 10, 500))}
                onBlur={onSearch}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={onPrev} disabled={offset === 0}>
              Prev
            </button>
            <button onClick={onNext} disabled={!canNext}>
              Next
            </button>
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((it) => (
              <li
                key={it.id}
                style={{
                  padding: 6,
                  marginBottom: 4,
                  border: it.id === selectedId ? "2px solid #4caf50" : "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 13,
                }}
                onClick={() => setSelectedId(it.id)}
              >
                <div>
                  <strong>{it.name || it.id}</strong> <code>({it.id})</code>
                </div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>
                  {it.rarity} • {it.category} • stack {it.max_stack}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: form */}
        <div style={{ flex: 1 }}>
          {form ? (
            <div style={{ border: "1px solid #ccc", borderRadius: 4, padding: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <label>
                  ID:
                  <input style={{ width: "100%" }} value={form.id} onChange={(e) => updateField("id", e.target.value)} />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Item Key (optional, defaults to ID):
                  <input
                    style={{ width: "100%" }}
                    value={form.item_key}
                    onChange={(e) => updateField("item_key", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Name:
                  <input style={{ width: "100%" }} value={form.name} onChange={(e) => updateField("name", e.target.value)} />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Description:
                  <textarea
                    style={{ width: "100%", height: 80 }}
                    value={form.description}
                    onChange={(e) => updateField("description", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <label style={{ flex: 1 }}>
                  Rarity:
                  <input style={{ width: "100%" }} value={form.rarity} onChange={(e) => updateField("rarity", e.target.value)} />
                </label>

                <label style={{ flex: 1 }}>
                  Category:
                  <input style={{ width: "100%" }} value={form.category} onChange={(e) => updateField("category", e.target.value)} />
                </label>

                <label style={{ flex: 1 }}>
                  Max Stack:
                  <input
                    type="number"
                    style={{ width: "100%" }}
                    value={form.max_stack}
                    onChange={(e) => updateField("max_stack", clampInt(e.target.value, 1, 1, 9999))}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <label style={{ flex: 1 }}>
                  Specialization ID:
                  <input
                    style={{ width: "100%" }}
                    value={form.specialization_id ?? ""}
                    onChange={(e) => updateField("specialization_id", e.target.value)}
                  />
                </label>

                <label style={{ flex: 1 }}>
                  Icon ID:
                  <input style={{ width: "100%" }} value={form.icon_id ?? ""} onChange={(e) => updateField("icon_id", e.target.value)} />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Flags (JSON):
                  <textarea
                    style={{ width: "100%", height: 80 }}
                    value={form.flagsText ?? ""}
                    onChange={(e) => updateField("flagsText", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Stats (JSON):
                  <textarea
                    style={{ width: "100%", height: 80 }}
                    value={form.statsText ?? ""}
                    onChange={(e) => updateField("statsText", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={handleSave} disabled={!canWrite || saving}>
                  {saving ? "Saving..." : "Save Item"}
                </button>
                <button type="button" onClick={startNew} disabled={saving}>
                  Clear / New
                </button>
              </div>

              {!canWrite && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>Read-only admin session.</div>}
            </div>
          ) : (
            <div>Select an item or click “New”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
