//web-frontend/pages/AdminQuestsPage.tsx

import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api";

const ADMIN_API_BASE = "http://192.168.0.74:4000";

type ObjectiveKind = "kill" | "harvest" | "collect_item" | "talk_to";

type AdminQuest = {
  id: string;
  name: string;
  description: string;
  repeatable: boolean;
  maxCompletions: number | null;

  objectiveKind: ObjectiveKind;
  objectiveTargetId: string;
  objectiveRequired: number;

  rewardXp: number;
  rewardGold: number;
};

export function AdminQuestsPage() {
  const [quests, setQuests] = useState<AdminQuest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminQuest | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing quests from DB
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${ADMIN_API_BASE}/api/admin/quests`, {
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: {
          ok: boolean;
          quests: AdminQuest[];
          error?: string;
        } = await res.json();
  
        if (!data.ok) throw new Error(data.error || "failed");
        setQuests(data.quests);
      } catch (err: any) {
        setError(err.message || String(err));
      }
    })();
  }, []);

  // When selecting a quest, populate form
  useEffect(() => {
    if (!selectedId) {
      setForm(null);
      return;
    }
    const q = quests.find((x) => x.id === selectedId);
    if (q) setForm(q);
  }, [selectedId, quests]);

  const startNew = () => {
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
    });
  };

  const updateField = <K extends keyof AdminQuest>(key: K, value: AdminQuest[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
  
    try {
      // 1) Save quest
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/quests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
  
      let payload: { ok?: boolean; error?: string } = {};
  
      // Try to read JSON even on 400 so we can surface backend error
      try {
        payload = await res.json();
      } catch {
        // ignore parse error, we'll fall back to status
      }
  
      if (!res.ok || payload.ok === false) {
        const msg =
          payload.error || `Save failed (HTTP ${res.status})`;
        throw new Error(msg);
      }
  
      // 2) Reload list after save
      const res2 = await fetch(`${ADMIN_API_BASE}/api/admin/quests`);
      const data2: {
        ok: boolean;
        quests: AdminQuest[];
        error?: string;
      } = await res2.json();
  
      if (!res2.ok || !data2.ok) {
        throw new Error(
          data2.error || `Reload failed (HTTP ${res2.status})`
        );
      }
  
      setQuests(data2.quests);
  
      // If we just created a new quest, select it
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
      <h1>Quest Editor (v0)</h1>

      {error && (
        <div style={{ color: "red", marginBottom: 8 }}>
          Error: {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: list */}
        <div style={{ minWidth: 260 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Quests in DB</strong>
            <button onClick={startNew}>New</button>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {quests.map((q) => (
              <li
                key={q.id}
                style={{
                  padding: 6,
                  marginBottom: 4,
                  border:
                    q.id === selectedId ? "2px solid #4caf50" : "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
                onClick={() => setSelectedId(q.id)}
              >
                <div>
                  <strong>{q.name}</strong> <code>({q.id})</code>
                </div>
                <div style={{ fontSize: 12 }}>
                  {q.repeatable ? "Repeatable" : "One-time"} •{" "}
                  {q.objectiveKind} {q.objectiveRequired}x {q.objectiveTargetId}
                </div>
              </li>
            ))}
            {quests.length === 0 && <li>No DB quests yet.</li>}
          </ul>
        </div>

        {/* Right: form */}
        <div style={{ flex: 1 }}>
          {form ? (
            <div style={{ border: "1px solid #ccc", borderRadius: 4, padding: 12 }}>
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
              <div style={{ marginBottom: 8 }}>
                <label>
                  Description:
                  <textarea
                    style={{ width: "100%", minHeight: 80 }}
                    value={form.description}
                    onChange={(e) => updateField("description", e.target.value)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={form.repeatable}
                    onChange={(e) => updateField("repeatable", e.target.checked)}
                  />{" "}
                  Repeatable
                </label>
                {form.repeatable && (
                  <div>
                    Max completions (empty = infinite):{" "}
                    <input
                      style={{ width: 80 }}
                      value={
                        form.maxCompletions === null ? "" : String(form.maxCompletions)
                      }
                      onChange={(e) =>
                        updateField(
                          "maxCompletions",
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
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
                      onChange={(e) =>
                        updateField("objectiveKind", e.target.value as ObjectiveKind)
                      }
                    >
                      <option value="kill">Kill</option>
                      <option value="harvest">Gathering</option>
                      <option value="collect_item">Collect Item</option>
                      <option value="talk_to">Talk to NPC</option>
                    </select>
                  </label>
                </div>
                <div style={{ marginBottom: 4 }}>
                  <label>
                    Target ID:{" "}
                    <input
                      value={form.objectiveTargetId}
                      onChange={(e) =>
                        updateField("objectiveTargetId", e.target.value)
                      }
                    />
                  </label>
                </div>
                <div>
                  <label>
                    Required:{" "}
                    <input
                      type="number"
                      value={form.objectiveRequired}
                      onChange={(e) =>
                        updateField("objectiveRequired", Number(e.target.value || 1))
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset style={{ marginBottom: 8 }}>
                <legend>Rewards</legend>
                <div style={{ marginBottom: 4 }}>
                  <label>
                    XP:{" "}
                    <input
                      type="number"
                      value={form.rewardXp}
                      onChange={(e) =>
                        updateField("rewardXp", Number(e.target.value || 0))
                      }
                    />
                  </label>
                </div>
                <div>
                  <label>
                    Gold:{" "}
                    <input
                      type="number"
                      value={form.rewardGold}
                      onChange={(e) =>
                        updateField("rewardGold", Number(e.target.value || 0))
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : "Save Quest"}
                </button>
                <button type="button" onClick={startNew} disabled={saving}>
                    Clear / New
                </button>
                </div>
            </div>
          ) : (
            <div>Select a quest or click “New”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
