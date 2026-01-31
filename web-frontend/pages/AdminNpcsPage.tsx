// web-frontend/pages/AdminNpcsPage.tsx

import { useEffect, useMemo, useState } from "react";
import { explainAdminError, getAdminCaps, getAuthToken } from "../lib/api";
import { ItemOption, ItemPicker } from "../components/ItemPicker";

type LootRow = {
  itemId: string;
  chance: number;
  minQty: number;
  maxQty: number;
  itemName?: string;
  itemRarity?: string;
};

type AdminNpc = {
  id: string;
  name: string;
  level: number;
  maxHp: number;
  dmgMin: number;
  dmgMax: number;
  model?: string;
  tagsText?: string;
  xpReward: number;
  loot: LootRow[];
};

const authedFetch: typeof fetch = (input: any, init?: any) => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...(init ?? {}), headers });
};

function clampNum(n: any, def: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

export function AdminNpcsPage() {
  const { canWrite } = getAdminCaps();
  const [npcs, setNpcs] = useState<AdminNpc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminNpc | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-loot-row resolved item meta (used for validation + labels)
  const [lootResolved, setLootResolved] = useState<Record<number, ItemOption | null>>({});

  // Load NPCs from DB
  useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch(`/api/admin/npcs`);
        const data: { ok: boolean; npcs: AdminNpc[]; error?: string } = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `Load failed (HTTP ${res.status})`);
        setNpcs(data.npcs || []);
      } catch (err: any) {
        setError(err.message || String(err));
      }
    })();
  }, []);

  // When selecting an NPC, populate form
  useEffect(() => {
    if (!selectedId) {
      setForm(null);
      setLootResolved({});
      return;
    }
    const it = npcs.find((x) => x.id === selectedId);
    if (it) {
      setForm({ ...it, loot: (it.loot ?? []).map((l) => ({ ...l })) });
      setLootResolved({});
    }
  }, [selectedId, npcs]);

  // Seed resolved meta from backend-enriched loot rows (so existing NPCs validate immediately)
  useEffect(() => {
    if (!form?.loot?.length) return;

    const next: Record<number, ItemOption | null> = {};
    for (let i = 0; i < form.loot.length; i++) {
      const r = form.loot[i];
      const id = String(r.itemId ?? "").trim();
      if (!id) continue;
      if (r.itemName) {
        next[i] = {
          id,
          name: String(r.itemName),
          rarity: r.itemRarity ? String(r.itemRarity) : "",
          label: r.itemName ? `${r.itemName} (${id})` : id,
        };
      }
    }

    // Only set if we have something to seed.
    if (Object.keys(next).length) setLootResolved((prev) => ({ ...next, ...prev }));
  }, [form?.id]);

  const startNew = () => {
    setSelectedId(null);
    setForm({
      id: "",
      name: "",
      level: 1,
      maxHp: 1,
      dmgMin: 0,
      dmgMax: 0,
      model: "",
      tagsText: "",
      xpReward: 0,
      loot: [],
    });
    setLootResolved({});
  };

  const updateField = <K extends keyof AdminNpc>(key: K, value: AdminNpc[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateLootRow = (idx: number, key: keyof LootRow, value: any) => {
    if (!form) return;
    const next = [...(form.loot ?? [])];
    const row = { ...(next[idx] ?? { itemId: "", chance: 1, minQty: 1, maxQty: 1 }) };

    if (key === "itemId") {
      row.itemId = String(value ?? "");
      // clear stale label on edit; picker will re-resolve
      delete row.itemName;
      delete row.itemRarity;
      setLootResolved((prev) => ({ ...prev, [idx]: null }));
    } else if (key === "chance") {
      row.chance = clampNum(value, 1, 0, 1);
    } else if (key === "minQty") {
      row.minQty = Math.max(0, Math.trunc(Number(value) || 0));
    } else if (key === "maxQty") {
      row.maxQty = Math.max(0, Math.trunc(Number(value) || 0));
    } else {
      (row as any)[key] = value;
    }

    next[idx] = row;
    setForm({ ...form, loot: next });
  };

  const addLootRow = () => {
    if (!form) return;
    setForm({
      ...form,
      loot: [...(form.loot ?? []), { itemId: "", chance: 1, minQty: 1, maxQty: 1 }],
    });
    // indices shift; easiest is to clear and let pickers resolve again
    setLootResolved({});
  };

  const removeLootRow = (idx: number) => {
    if (!form) return;
    const next = [...(form.loot ?? [])];
    next.splice(idx, 1);
    setForm({ ...form, loot: next });
    setLootResolved({});
  };

  const unknownLoot = useMemo(() => {
    const issues: { idx: number; itemId: string }[] = [];
    for (let i = 0; i < (form?.loot?.length ?? 0); i++) {
      const row = form!.loot[i];
      const itemId = String(row.itemId ?? "").trim();
      if (!itemId) continue;
      if (!lootResolved[i]) issues.push({ idx: i, itemId });
    }
    return issues;
  }, [form?.loot, lootResolved]);

  const canSave = canWrite && !saving && unknownLoot.length === 0;

  const handleSave = async () => {
    if (!form) return;
    if (unknownLoot.length) {
      setError(
        `Cannot save: ${unknownLoot.length} loot row(s) reference unknown item_id(s). Fix typos or create the items first.`
      );
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await authedFetch(`/api/admin/npcs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      let payload: { ok?: boolean; error?: string } = {};
      try {
        payload = await res.json();
      } catch {
        // ignore
      }

      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || explainAdminError(String(res.status)));
      }

      // Reload list
      const res2 = await authedFetch(`/api/admin/npcs`);
      const data2: { ok: boolean; npcs: AdminNpc[]; error?: string } = await res2.json();
      if (!res2.ok || !data2.ok) {
        throw new Error(data2.error || explainAdminError(String(res2.status)));
      }

      setNpcs(data2.npcs || []);

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

      {error && <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: list */}
        <div style={{ minWidth: 300 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>NPCs in DB</strong>
            <button onClick={startNew}>New</button>
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {npcs.map((it) => (
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
                  <strong>{it.name}</strong> <code>({it.id})</code>
                </div>
                <div style={{ fontSize: 11 }}>lvl {it.level} • HP {it.maxHp} • dmg {it.dmgMin}-{it.dmgMax}</div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>tags: {it.tagsText || "(none)"}</div>
              </li>
            ))}
            {npcs.length === 0 && <li>No DB NPCs yet.</li>}
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
                  Name:
                  <input
                    style={{ width: "100%" }}
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <label style={{ flex: 1 }}>
                  Level:
                  <input
                    type="number"
                    style={{ width: "100%" }}
                    value={form.level}
                    onChange={(e) => updateField("level", Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                  />
                </label>

                <label style={{ flex: 1 }}>
                  Max HP:
                  <input
                    type="number"
                    style={{ width: "100%" }}
                    value={form.maxHp}
                    onChange={(e) => updateField("maxHp", Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <label style={{ flex: 1 }}>
                  Damage min:
                  <input
                    type="number"
                    style={{ width: "100%" }}
                    value={form.dmgMin}
                    onChange={(e) => updateField("dmgMin", Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                  />
                </label>

                <label style={{ flex: 1 }}>
                  Damage max:
                  <input
                    type="number"
                    style={{ width: "100%" }}
                    value={form.dmgMax}
                    onChange={(e) => updateField("dmgMax", Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
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
                    style={{ width: "100%" }}
                    value={form.xpReward}
                    onChange={(e) => updateField("xpReward", Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                  />
                </label>
              </div>

              <fieldset style={{ marginTop: 12 }}>
                <legend>Loot (optional)</legend>

                {unknownLoot.length > 0 && (
                  <div
                    style={{
                      padding: 8,
                      marginBottom: 8,
                      border: "1px solid #b00020",
                      borderRadius: 4,
                      background: "#fff5f5",
                    }}
                  >
                    <strong style={{ color: "#b00020" }}>Loot validation:</strong>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      {unknownLoot.map((u) => (
                        <div key={`${u.idx}:${u.itemId}`}>
                          Row {u.idx + 1}: unknown <code>{u.itemId}</code>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
                      Fix typos or create the items in the Item Editor first.
                    </div>
                  </div>
                )}

                {form.loot?.length ? (
                  form.loot.map((row, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                      <ItemPicker
                        value={row.itemId}
                        onChange={(next) => updateLootRow(idx, "itemId", next)}
                        disabled={!canWrite || saving}
                        listId={`npc-loot-items-${idx}`}
                        onResolved={(opt) => {
                          setLootResolved((prev) => ({ ...prev, [idx]: opt }));
                          if (opt) {
                            // Also carry label in the payload for nicer UX when reselecting.
                            setForm((prev) => {
                              if (!prev) return prev;
                              const loot = [...(prev.loot ?? [])];
                              const r = { ...(loot[idx] ?? row) };
                              r.itemName = opt.name;
                              r.itemRarity = opt.rarity;
                              loot[idx] = r;
                              return { ...prev, loot };
                            });
                          }
                        }}
                        style={{ width: 220 }}
                      />

                      <input
                        type="number"
                        placeholder="chance"
                        style={{ width: 80 }}
                        value={row.chance}
                        step="0.01"
                        min="0"
                        max="1"
                        onChange={(e) => updateLootRow(idx, "chance", e.target.value)}
                      />
                      <input
                        type="number"
                        placeholder="min"
                        style={{ width: 60 }}
                        value={row.minQty}
                        onChange={(e) => updateLootRow(idx, "minQty", e.target.value)}
                      />
                      <input
                        type="number"
                        placeholder="max"
                        style={{ width: 60 }}
                        value={row.maxQty}
                        onChange={(e) => updateLootRow(idx, "maxQty", e.target.value)}
                      />
                      <button type="button" onClick={() => removeLootRow(idx)} disabled={!canWrite || saving}>
                        X
                      </button>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, marginBottom: 4 }}>No loot rows. Add some if this NPC should drop items.</div>
                )}

                <button type="button" onClick={addLootRow} disabled={!canWrite || saving}>
                  Add Loot Row
                </button>
              </fieldset>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={handleSave} disabled={!canSave}>
                  {saving ? "Saving..." : "Save NPC"}
                </button>
                <button type="button" onClick={startNew} disabled={saving}>
                  Clear / New
                </button>
              </div>

              {!canWrite && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>Read-only admin session.</div>}
            </div>
          ) : (
            <div>Select an NPC or click “New”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
