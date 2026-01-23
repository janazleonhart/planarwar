// web-frontend/pages/AdminNpcsPage.tsx

import { useEffect, useState } from "react";

type AdminNpcLootRow = {
  itemId: string;
  chance: number;
  minQty: number;
  maxQty: number;
};

type AdminNpc = {
  id: string;
  name: string;
  level: number;
  maxHp: number;
  dmgMin: number;
  dmgMax: number;
  model?: string;
  tagsText?: string; // comma-separated
  xpReward: number;
  loot: AdminNpcLootRow[];
};

export function AdminNpcsPage() {
  const [npcs, setNpcs] = useState<AdminNpc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminNpc | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing NPCs from DB
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/npcs`);
        if (!res.ok) {
          throw new Error(`Load failed (HTTP ${res.status})`);
        }
        const data: {
          ok: boolean;
          npcs: AdminNpc[];
          error?: string;
        } = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Failed to load NPCs");
        }
        setNpcs(data.npcs);
      } catch (err: any) {
        setError(err.message || String(err));
      }
    })();
  }, []);

  // When selecting an NPC, populate form
  useEffect(() => {
    if (!selectedId) {
      setForm(null);
      return;
    }
    const npc = npcs.find((x) => x.id === selectedId);
    if (npc) {
      // clone to avoid mutating list
      setForm({
        ...npc,
        loot: npc.loot ? npc.loot.map((l) => ({ ...l })) : [],
      });
    }
  }, [selectedId, npcs]);

  const startNew = () => {
    setSelectedId(null);
    setForm({
      id: "",
      name: "",
      level: 1,
      maxHp: 10,
      dmgMin: 1,
      dmgMax: 2,
      model: "",
      tagsText: "",
      xpReward: 0,
      loot: [],
    });
  };

  const updateField = <K extends keyof AdminNpc>(key: K, value: AdminNpc[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateLootRow = (
    index: number,
    key: keyof AdminNpcLootRow,
    value: string | number
  ) => {
    setForm((prev) => {
      if (!prev) return prev;
      const nextLoot = [...(prev.loot || [])];
      const row = {
        ...(nextLoot[index] || {
          itemId: "",
          chance: 1,
          minQty: 1,
          maxQty: 1,
        }),
      };
      if (key === "itemId") {
        row.itemId = String(value);
      } else {
        const num = Number(value || 0);
        (row as any)[key] = num;
      }
      nextLoot[index] = row;
      return { ...prev, loot: nextLoot };
    });
  };

  const addLootRow = () => {
    setForm((prev) => {
      if (!prev) return prev;
      const nextLoot = [...(prev.loot || [])];
      nextLoot.push({
        itemId: "",
        chance: 1,
        minQty: 1,
        maxQty: 1,
      });
      return { ...prev, loot: nextLoot };
    });
  };

  const removeLootRow = (index: number) => {
    setForm((prev) => {
      if (!prev) return prev;
      const nextLoot = [...(prev.loot || [])];
      nextLoot.splice(index, 1);
      return { ...prev, loot: nextLoot };
    });
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/npcs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      let payload: { ok?: boolean; error?: string; npcs?: AdminNpc[] } = {};

      try {
        payload = await res.json();
      } catch {
        // If response wasn't JSON, we'll fall back to status text.
      }

      if (!res.ok || payload.ok === false) {
        const msg =
          payload.error || `Save failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      // Reload list (prefer the existing GET route so we stay consistent)
      const res2 = await fetch(`/api/admin/npcs`);
      const data2: {
        ok: boolean;
        npcs: AdminNpc[];
        error?: string;
      } = await res2.json();
      if (!res2.ok || !data2.ok) {
        throw new Error(
          data2.error || `Reload failed (HTTP ${res2.status})`
        );
      }
      setNpcs(data2.npcs);

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
      <h1>NPC Editor (v0)</h1>

      {error && (
        <div style={{ color: "red", marginBottom: 8 }}>
          Error: {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: list */}
        <div style={{ minWidth: 260 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <strong>NPCs in DB</strong>
            <button onClick={startNew}>New</button>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {npcs.map((n) => (
              <li
                key={n.id}
                style={{
                  padding: 6,
                  marginBottom: 4,
                  border:
                    n.id === selectedId
                      ? "2px solid #4caf50"
                      : "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
                onClick={() => setSelectedId(n.id)}
              >
                <div>
                  <strong>{n.name}</strong> <code>({n.id})</code>
                </div>
                <div style={{ fontSize: 12 }}>
                  lvl {n.level} • HP {n.maxHp} • dmg {n.dmgMin}-{n.dmgMax}
                </div>
                {n.tagsText && (
                  <div style={{ fontSize: 11, opacity: 0.8 }}>
                    tags: {n.tagsText}
                  </div>
                )}
              </li>
            ))}
            {npcs.length === 0 && <li>No DB NPCs yet.</li>}
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
                  Name:
                  <input
                    style={{ width: "100%" }}
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
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
                  Level:
                  <input
                    type="number"
                    style={{ width: 80, marginLeft: 4 }}
                    value={form.level}
                    onChange={(e) =>
                      updateField("level", Number(e.target.value || 1))
                    }
                  />
                </label>
                <label>
                  Max HP:
                  <input
                    type="number"
                    style={{ width: 80, marginLeft: 4 }}
                    value={form.maxHp}
                    onChange={(e) =>
                      updateField("maxHp", Number(e.target.value || 1))
                    }
                  />
                </label>
                <label>
                  Damage min:
                  <input
                    type="number"
                    style={{ width: 80, marginLeft: 4 }}
                    value={form.dmgMin}
                    onChange={(e) =>
                      updateField("dmgMin", Number(e.target.value || 0))
                    }
                  />
                </label>
                <label>
                  Damage max:
                  <input
                    type="number"
                    style={{ width: 80, marginLeft: 4 }}
                    value={form.dmgMax}
                    onChange={(e) =>
                      updateField("dmgMax", Number(e.target.value || 0))
                    }
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Model (optional):
                  <input
                    style={{ width: "100%" }}
                    value={form.model ?? ""}
                    onChange={(e) => updateField("model", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  Tags (comma-separated):
                  <input
                    style={{ width: "100%" }}
                    value={form.tagsText ?? ""}
                    onChange={(e) => updateField("tagsText", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  XP Reward:
                  <input
                    type="number"
                    style={{ width: 120, marginLeft: 4 }}
                    value={form.xpReward}
                    onChange={(e) =>
                      updateField("xpReward", Number(e.target.value || 0))
                    }
                  />
                </label>
              </div>

              <fieldset style={{ marginBottom: 8 }}>
                <legend>Loot (optional)</legend>
                {form.loot && form.loot.length > 0 ? (
                  form.loot.map((row, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        gap: 4,
                        alignItems: "center",
                        marginBottom: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <input
                        placeholder="itemId"
                        style={{ minWidth: 140 }}
                        value={row.itemId}
                        onChange={(e) =>
                          updateLootRow(idx, "itemId", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder="chance"
                        style={{ width: 80 }}
                        value={row.chance}
                        onChange={(e) =>
                          updateLootRow(idx, "chance", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        placeholder="min"
                        style={{ width: 60 }}
                        value={row.minQty}
                        onChange={(e) =>
                          updateLootRow(idx, "minQty", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        placeholder="max"
                        style={{ width: 60 }}
                        value={row.maxQty}
                        onChange={(e) =>
                          updateLootRow(idx, "maxQty", e.target.value)
                        }
                      />
                      <button
                        type="button"
                        onClick={() => removeLootRow(idx)}
                      >
                        X
                      </button>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    No loot rows. Add some if this NPC should drop items.
                  </div>
                )}
                <button type="button" onClick={addLootRow}>
                  Add Loot Row
                </button>
              </fieldset>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save NPC"}
                </button>
                <button type="button" onClick={startNew} disabled={saving}>
                  Clear / New
                </button>
              </div>
            </div>
          ) : (
            <div>Select an NPC or click “New”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
