// web-frontend/pages/AdminItemsPage.tsx

import { useEffect, useState } from "react";

const ADMIN_API_BASE = "http://192.168.0.74:4000";

type AdminItem = {
  id: string;
  item_key: string;
  name: string;
  description: string;
  rarity: string;
  category: string;
  specialization_id: string;
  icon_id: string;
  max_stack: number;
  flagsText: string;
  statsText: string;
};

export function AdminItemsPage() {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load items from DB
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/items`);
        if (!res.ok) {
          throw new Error(`Load failed (HTTP ${res.status})`);
        }
        const data: {
          ok: boolean;
          items: AdminItem[];
          error?: string;
        } = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Failed to load items");
        }
        setItems(data.items);
      } catch (err: any) {
        setError(err.message || String(err));
      }
    })();
  }, []);

  // When selecting an item, populate form
  useEffect(() => {
    if (!selectedId) {
      setForm(null);
      return;
    }
    const it = items.find((x) => x.id === selectedId);
    if (it) {
      setForm({ ...it });
    }
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

  const updateField = <K extends keyof AdminItem>(
    key: K,
    value: AdminItem[K]
  ) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      let payload: { ok?: boolean; error?: string } = {};
      try {
        payload = await res.json();
      } catch {
        // ignore parse error; fall back to status
      }

      if (!res.ok || payload.ok === false) {
        const msg =
          payload.error || `Save failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      // Reload list
      const res2 = await fetch(`${ADMIN_API_BASE}/api/admin/items`);
      const data2: {
        ok: boolean;
        items: AdminItem[];
        error?: string;
      } = await res2.json();

      if (!res2.ok || !data2.ok) {
        throw new Error(
          data2.error || `Reload failed (HTTP ${res2.status})`
        );
      }

      setItems(data2.items);

      if (!selectedId) {
        setSelectedId(form.id);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>Item Editor (v0)</h1>

      {error && (
        <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>
      )}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: list */}
        <div style={{ minWidth: 280 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <strong>Items in DB</strong>
            <button onClick={startNew}>New</button>
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((it) => (
              <li
                key={it.id}
                style={{
                  padding: 6,
                  marginBottom: 4,
                  border:
                    it.id === selectedId
                      ? "2px solid #4caf50"
                      : "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 13,
                }}
                onClick={() => setSelectedId(it.id)}
              >
                <div>
                  <strong>{it.name}</strong> <code>({it.id})</code>
                </div>
                <div style={{ fontSize: 11 }}>
                  {it.rarity || "common"} • {it.category || "misc"} • stack{" "}
                  {it.max_stack}
                </div>
              </li>
            ))}
            {items.length === 0 && <li>No DB items yet.</li>}
          </ul>
        </div>

        {/* Right: form */}
        <div style={{ flex: 1 }}>
          {form ? (
            <div
              style={{
                border: "1px solid #ccc",
                borderRadius: 4,
                padding: 12,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <label>
                  ID:
                  <input
                    style={{ width: "100%" }}
                    value={form.id}
                    onChange={(e) => updateField("id", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Item Key (optional, defaults to ID):
                  <input
                    style={{ width: "100%" }}
                    value={form.item_key}
                    onChange={(e) =>
                      updateField("item_key", e.target.value)
                    }
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Name:
                  <input
                    style={{ width: "100%" }}
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Description:
                  <textarea
                    style={{ width: "100%", minHeight: 60 }}
                    value={form.description}
                    onChange={(e) =>
                      updateField("description", e.target.value)
                    }
                  />
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <label>
                  Rarity:
                  <input
                    style={{ width: 120, marginLeft: 4 }}
                    value={form.rarity}
                    onChange={(e) => updateField("rarity", e.target.value)}
                  />
                </label>
                <label>
                  Category:
                  <input
                    style={{ width: 120, marginLeft: 4 }}
                    value={form.category}
                    onChange={(e) => updateField("category", e.target.value)}
                  />
                </label>
                <label>
                  Max Stack:
                  <input
                    type="number"
                    style={{ width: 80, marginLeft: 4 }}
                    value={form.max_stack}
                    onChange={(e) =>
                      updateField(
                        "max_stack",
                        Number(e.target.value || 1)
                      )
                    }
                  />
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <label>
                  Specialization ID:
                  <input
                    style={{ width: 180, marginLeft: 4 }}
                    value={form.specialization_id}
                    onChange={(e) =>
                      updateField("specialization_id", e.target.value)
                    }
                  />
                </label>
                <label>
                  Icon ID:
                  <input
                    style={{ width: 180, marginLeft: 4 }}
                    value={form.icon_id}
                    onChange={(e) => updateField("icon_id", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Flags (JSON):
                  <textarea
                    style={{ width: "100%", minHeight: 60 }}
                    value={form.flagsText}
                    onChange={(e) =>
                      updateField("flagsText", e.target.value)
                    }
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Stats (JSON):
                  <textarea
                    style={{ width: "100%", minHeight: 60 }}
                    value={form.statsText}
                    onChange={(e) =>
                      updateField("statsText", e.target.value)
                    }
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save Item"}
                </button>
                <button type="button" onClick={startNew} disabled={saving}>
                  Clear / New
                </button>
              </div>
            </div>
          ) : (
            <div>Select an item or click “New”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
