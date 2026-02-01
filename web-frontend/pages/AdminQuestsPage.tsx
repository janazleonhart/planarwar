// web-frontend/pages/AdminQuestsPage.tsx

import { useEffect, useId, useMemo, useState } from "react";
import { getAdminCaps, getAuthToken } from "../lib/api";
import { AdminNotice, AdminPanel, AdminShell, AdminTwoCol } from "../components/admin/AdminUI";

type ObjectiveKind = "kill" | "harvest" | "collect_item" | "craft" | "talk_to" | "city";

type RewardItem = {
  itemId: string;
  count: number;
  itemName?: string;
  itemRarity?: string;
};

type AdminQuest = {
  id: string;
  name: string;
  description: string;
  repeatable: boolean;
  maxCompletions: number | null;

  objectiveKind: ObjectiveKind;
  objectiveTargetId: string;
  objectiveRequired: number;

  objectiveTargetName?: string;
  objectiveTargetRarity?: string;

  rewardXp: number;
  rewardGold: number;
  rewardItems?: RewardItem[];
};

function labelForTarget(kind: ObjectiveKind): string {
  switch (kind) {
    case "kill":
      return "Target NPC/Proto ID";
    case "talk_to":
      return "NPC ID";
    case "harvest":
      return "Node ID";
    case "collect_item":
      return "Item ID";
    case "craft":
      return "Action ID (e.g. craft:brew_minor_heal)";
    case "city":
      return "City Action ID (e.g. city:build:granary)";
    default:
      return "Target ID";
  }
}

type ItemOption = {
  id: string;
  name?: string | null;
  rarity?: string | null;
  label?: string | null; // optional prebuilt label from API
};

function formatItemLabel(opt: ItemOption): string {
  const name = (opt.label && opt.label.trim()) || (opt.name ? String(opt.name) : "");
  const rarity = opt.rarity ? String(opt.rarity) : "";
  const bits: string[] = [];
  if (name) bits.push(name);
  bits.push(opt.id);
  let out = bits.length === 2 ? `${bits[0]} (${bits[1]})` : opt.id;
  if (rarity) out = `${out} [${rarity}]`;
  return out;
}

function formatItemIdWithMeta(itemId: string, name?: string, rarity?: string): string {
  const id = (itemId || "").trim();
  const n = (name || "").trim();
  const r = (rarity || "").trim();
  let out = n ? `${n} (${id})` : id;
  if (r) out = `${out} [${r}]`;
  return out;
}

function formatObjectiveTarget(q: AdminQuest): string {
  if (q.objectiveKind !== "collect_item") return q.objectiveTargetId;
  return formatItemIdWithMeta(q.objectiveTargetId, q.objectiveTargetName, q.objectiveTargetRarity);
}

const authedFetch: typeof fetch = (input: any, init?: any) => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...(init ?? {}), headers });
};

function ItemIdPicker(props: {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (next: string) => void;
  onResolved?: (opt: ItemOption | null) => void;
}) {
  const { value, disabled, placeholder, onChange, onResolved } = props;
  const [options, setOptions] = useState<ItemOption[]>([]);
  const [loading, setLoading] = useState(false);
  const rid = useId();
  const listId = useMemo(() => `adminQuestItemIdOptions-${rid}`, [rid]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const q = (value || "").trim();
      if (!q) {
        setOptions([]);
        if (onResolved) onResolved(null);
        return;
      }
      setLoading(true);
      try {
        const res = await authedFetch(`/api/admin/items/options?q=${encodeURIComponent(q)}&limit=20`);
        const data = (await res.json()) as { ok?: boolean; items?: ItemOption[]; error?: string };
        const arr = (data.items ?? []).map((x) => ({
          id: String((x as any).id ?? ""),
          name: (x as any).name ?? null,
          rarity: (x as any).rarity ?? null,
          label: (x as any).label ?? null,
        }));
        if (!alive) return;
        setOptions(arr);

        const exact = arr.find((x) => x.id === q);
        if (onResolved) onResolved(exact ?? null);
      } catch {
        if (!alive) return;
        setOptions([]);
        if (onResolved) onResolved(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <input
          value={value}
          disabled={disabled}
          list={listId}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "item id (e.g. rat_tail)"}
        />
        {loading && <span style={{ fontSize: 12, opacity: 0.7 }}>…</span>}
      </div>
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.id} value={o.id} label={formatItemLabel(o)} />
        ))}
      </datalist>
    </div>
  );
}

export function AdminQuestsPage() {
  const { canWrite } = getAdminCaps();
  const [quests, setQuests] = useState<AdminQuest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminQuest | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pickers resolve best-effort; used for client-side safety rails
  const [objectiveItemResolved, setObjectiveItemResolved] = useState<ItemOption | null>(null);
  const [rewardResolved, setRewardResolved] = useState<Record<number, ItemOption | null>>({});

  async function reloadList() {
    const res = await authedFetch(`/api/admin/quests`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { ok: boolean; quests: AdminQuest[]; error?: string } = await res.json();
    if (!data.ok) throw new Error(data.error || "failed");
    setQuests(data.quests);
  }

  useEffect(() => {
    (async () => {
      try {
        await reloadList();
      } catch (err: any) {
        setError(err.message || String(err));
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setForm(null);
      return;
    }
    const q = quests.find((x) => x.id === selectedId);
    if (q) {
      setForm(q);
      setObjectiveItemResolved(null);
      setRewardResolved({});
    }
  }, [selectedId, quests]);

  const startNew = () => {
    setObjectiveItemResolved(null);
    setRewardResolved({});
    setSelectedId(null);
    setForm({
      id: "",
      name: "",
      description: "",
      repeatable: false,
      maxCompletions: null,
      objectiveKind: "kill",
      objectiveTargetId: "",
      objectiveRequired: 1,
      rewardXp: 0,
      rewardGold: 0,
      rewardItems: [],
    });
  };

  const updateField = <K extends keyof AdminQuest>(key: K, value: AdminQuest[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateRewardItem = (idx: number, patch: Partial<RewardItem>) => {
    setForm((prev) => {
      if (!prev) return prev;
      const list = [...(prev.rewardItems ?? [])];
      const cur = list[idx] ?? { itemId: "", count: 1 };
      list[idx] = { ...cur, ...patch };
      return { ...prev, rewardItems: list };
    });
  };

  const addRewardItem = () => {
    setForm((prev) => {
      if (!prev) return prev;
      const list = [...(prev.rewardItems ?? [])];
      list.push({ itemId: "", count: 1 });
      return { ...prev, rewardItems: list };
    });
  };

  const removeRewardItem = (idx: number) => {
    setForm((prev) => {
      if (!prev) return prev;
      const list = [...(prev.rewardItems ?? [])];
      list.splice(idx, 1);
      return { ...prev, rewardItems: list };
    });

    setRewardResolved((prev) => {
      const next: Record<number, ItemOption | null> = {};
      const entries = Object.entries(prev);
      for (const [k, v] of entries) {
        const i = Number(k);
        if (Number.isNaN(i)) continue;
        if (i < idx) next[i] = v;
        else if (i > idx) next[i - 1] = v;
      }
      return next;
    });
  };

  const validateCollectItemObjective = (q: AdminQuest) => {
    if (q.objectiveKind !== "collect_item") return;
    const id = (q.objectiveTargetId || "").trim();
    const serverKnows = !!(q.objectiveTargetName && q.objectiveTargetId.trim() === id);
    if (id && !objectiveItemResolved && !serverKnows) {
      throw new Error(
        `Unknown item id '${id}'. Use the picker to select a real item (or create it in the Item Editor first).`
      );
    }
  };

  const validateRewardItems = (q: AdminQuest) => {
    const items = q.rewardItems ?? [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const id = (it.itemId || "").trim();
      if (!id) continue;

      const serverKnows = !!(it.itemName && it.itemId.trim() === id);
      const resolved = rewardResolved[i];

      if (!resolved && !serverKnows) {
        throw new Error(
          `Unknown reward item id '${id}' (row ${i + 1}). Use the picker to select a real item (or create it first).`
        );
      }
      const count = Number(it.count || 1);
      if (!Number.isFinite(count) || count < 1) {
        throw new Error(`Reward item count must be >= 1 (row ${i + 1}).`);
      }
    }
  };

  const handleSave = async () => {
    if (!form) return;

    try {
      validateCollectItemObjective(form);
      validateRewardItems(form);
    } catch (err: any) {
      setError(err.message || String(err));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await authedFetch(`/api/admin/quests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      let payload: { ok?: boolean; error?: string } = {};
      try {
        payload = await res.json();
      } catch {
        // ignore parse errors
      }

      if (!res.ok || payload.ok === false) {
        const msg = payload.error || `Save failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      await reloadList();

      if (!selectedId) setSelectedId(form.id);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell
      title="Quests"
      subtitle="Quest editor (v0) • /api/admin/quests"
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
          <AdminPanel title="Quests in DB" subtitle="Select a quest to edit">
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {quests.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    className="pw-card"
                    data-active={q.id === selectedId ? "true" : "false"}
                    onClick={() => setSelectedId(q.id)}
                    style={{ width: "100%", textAlign: "left" }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 13 }}>
                      {q.name} <code>({q.id})</code>
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)", marginTop: 2 }}>
                      {q.repeatable ? "Repeatable" : "One-time"} • {q.objectiveKind} {q.objectiveRequired}x {formatObjectiveTarget(q)}
                    </div>
                  </button>
                </li>
              ))}
              {quests.length === 0 ? <li style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>No DB quests yet.</li> : null}
            </ul>
          </AdminPanel>
        }
        right={
          <AdminPanel title="Editor" subtitle="Edit objective + rewards, then save">
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
                    <input style={{ width: "100%" }} value={form.name} onChange={(e) => updateField("name", e.target.value)} />
                  </label>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label>
                    Description:
                    <textarea style={{ width: "100%", minHeight: 80 }} value={form.description} onChange={(e) => updateField("description", e.target.value)} />
                  </label>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label>
                    <input type="checkbox" checked={form.repeatable} onChange={(e) => updateField("repeatable", e.target.checked)} />{" "}
                    Repeatable
                  </label>

                  {form.repeatable && (
                    <div>
                      Max completions (empty = infinite):{" "}
                      <input
                        style={{ width: 80 }}
                        value={form.maxCompletions === null ? "" : String(form.maxCompletions)}
                        onChange={(e) => updateField("maxCompletions", e.target.value === "" ? null : Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>

                <fieldset style={{ marginBottom: 8 }}>
                  <legend>Objective (single, v0)</legend>

                  <div style={{ marginBottom: 4 }}>
                    <label>
                      Kind:{" "}
                      <select
                        value={form.objectiveKind}
                        onChange={(e) => {
                          const next = e.target.value as ObjectiveKind;
                          updateField("objectiveKind", next);
                          setObjectiveItemResolved(null);
                        }}
                      >
                        <option value="kill">Kill</option>
                        <option value="harvest">Gathering</option>
                        <option value="collect_item">Collect Item</option>
                        <option value="craft">Craft</option>
                        <option value="talk_to">Talk to NPC</option>
                        <option value="city">City Action</option>
                      </select>
                    </label>
                  </div>

                  <div style={{ marginBottom: 4 }}>
                    <label>
                      {labelForTarget(form.objectiveKind)}:{" "}
                      {form.objectiveKind === "collect_item" ? (
                        <ItemIdPicker
                          value={form.objectiveTargetId}
                          disabled={saving || !canWrite}
                          onChange={(next) => updateField("objectiveTargetId", next)}
                          onResolved={(opt) => setObjectiveItemResolved(opt)}
                        />
                      ) : (
                        <input value={form.objectiveTargetId} onChange={(e) => updateField("objectiveTargetId", e.target.value)} />
                      )}
                    </label>
                  </div>

                  <div>
                    <label>
                      Required:{" "}
                      <input
                        type="number"
                        value={form.objectiveRequired}
                        onChange={(e) => updateField("objectiveRequired", Number(e.target.value || 1))}
                      />
                    </label>
                  </div>
                </fieldset>

                <fieldset style={{ marginBottom: 8 }}>
                  <legend>Rewards</legend>

                  <div style={{ marginBottom: 4 }}>
                    <label>
                      XP:{" "}
                      <input type="number" value={form.rewardXp} onChange={(e) => updateField("rewardXp", Number(e.target.value || 0))} />
                    </label>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <label>
                      Gold:{" "}
                      <input type="number" value={form.rewardGold} onChange={(e) => updateField("rewardGold", Number(e.target.value || 0))} />
                    </label>
                  </div>

                  <div style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <strong>Item rewards</strong>
                      <button type="button" onClick={addRewardItem} disabled={saving || !canWrite}>
                        + Add item
                      </button>
                    </div>

                    {(form.rewardItems ?? []).length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                        {(form.rewardItems ?? []).map((it, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              padding: 6,
                              border: "1px solid #ddd",
                              borderRadius: 4,
                              flexWrap: "wrap",
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 220 }}>
                              <ItemIdPicker
                                value={it.itemId}
                                disabled={saving || !canWrite}
                                placeholder="reward item id (e.g. rat_tail)"
                                onChange={(next) => {
                                  updateRewardItem(idx, { itemId: next });
                                  setRewardResolved((prev) => ({ ...prev, [idx]: null }));
                                }}
                                onResolved={(opt) => setRewardResolved((prev) => ({ ...prev, [idx]: opt }))}
                              />
                              {(it.itemName || it.itemRarity) && (
                                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                                  {formatItemIdWithMeta(it.itemId, it.itemName, it.itemRarity)}
                                </div>
                              )}
                            </div>

                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              Qty
                              <input
                                type="number"
                                style={{ width: 80 }}
                                value={it.count ?? 1}
                                onChange={(e) => updateRewardItem(idx, { count: Number(e.target.value || 1) })}
                                disabled={saving || !canWrite}
                                min={1}
                              />
                            </label>

                            <button type="button" onClick={() => removeRewardItem(idx)} disabled={saving || !canWrite}>
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>No item rewards yet.</div>
                    )}
                  </div>
                </fieldset>

                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button type="button" data-kind="primary" onClick={handleSave} disabled={saving || !canWrite}>
                    {saving ? "Saving..." : "Save Quest"}
                  </button>
                  <button type="button" onClick={startNew} disabled={saving}>
                    Clear / New
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>Select a quest or click “New”.</div>
            )}
          </AdminPanel>
        }
      />
    </AdminShell>
  );
}
