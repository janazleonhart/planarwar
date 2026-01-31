// web-frontend/pages/AdminSpellsPage.tsx

import { useEffect, useMemo, useState } from "react";
import { explainAdminError, getAdminCaps, getAuthToken } from "../lib/api";

type AdminSpell = {
  id: string;
  name: string;
  description: string;
  kind: string;
  class_id: string | null;
  min_level: number;
  school: string;
  is_song: boolean;
  song_school: string | null;
  resource_type: string;
  resource_cost: number;
  cooldown_ms: number;
  damage_multiplier: number;
  flat_bonus: number;
  heal_amount: number;
  flags: unknown | null;
  tags: string[];
  status_effect: unknown | null;
  cleanse: unknown | null;
  is_debug: boolean;
  is_dev_only: boolean;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
  // editor helpers
  flagsText?: string;
  tagsText?: string;
  statusEffectText?: string;
  cleanseText?: string;
};

const authedFetch: typeof fetch = (input: any, init?: any) => {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(init?.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(input, {
    ...(init || {}),
    headers,
  });
};

function safeJsonStringify(v: any) {
  try {
    if (v === undefined || v === null) return "";
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

function normalizeIncomingSpell(s: AdminSpell): AdminSpell {
  return {
    ...s,
    flagsText: safeJsonStringify(s.flags),
    tagsText: (s.tags || []).join(", "),
    statusEffectText: safeJsonStringify(s.status_effect),
    cleanseText: safeJsonStringify(s.cleanse),
  };
}

function buildDraftForNewSpell(): AdminSpell {
  return {
    id: "",
    name: "",
    description: "",
    kind: "spell",
    class_id: null,
    min_level: 1,
    school: "arcane",
    is_song: false,
    song_school: null,
    resource_type: "mana",
    resource_cost: 0,
    cooldown_ms: 0,
    damage_multiplier: 1,
    flat_bonus: 0,
    heal_amount: 0,
    flags: null,
    tags: [],
    status_effect: null,
    cleanse: null,
    is_debug: false,
    is_dev_only: false,
    is_enabled: true,
    flagsText: "",
    tagsText: "",
    statusEffectText: "",
    cleanseText: "",
  };
}

function parseJsonOrNull(text: string): unknown | null {
  const t = (text || "").trim();
  if (!t) return null;
  return JSON.parse(t);
}

function parseTags(text: string): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  return t
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function AdminSpellsPage() {
  const [capsError, setCapsError] = useState<string | null>(null);
  const [q, setQ] = useState<string>("");
  const [spells, setSpells] = useState<AdminSpell[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminSpell | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await getAdminCaps();
      } catch (e: any) {
        setCapsError(explainAdminError(e));
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return spells;
    return spells.filter((s) =>
      `${s.id} ${s.name}`.toLowerCase().includes(needle)
    );
  }, [q, spells]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      qs.set("limit", "250");
      qs.set("offset", "0");

      const res = await authedFetch(`/api/admin/spells?${qs.toString()}`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const list = (data?.spells || []) as AdminSpell[];
      setSpells(list.map(normalizeIncomingSpell));

      // keep selection stable
      if (selectedId) {
        const match = list.find((s) => s.id === selectedId);
        if (match) {
          setDraft(normalizeIncomingSpell(match));
        }
      }
    } catch (e: any) {
      setError(explainAdminError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // first load
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectSpell(id: string) {
    setSelectedId(id);
    const found = spells.find((s) => s.id === id);
    if (found) setDraft({ ...found });
  }

  function newSpell() {
    setSelectedId(null);
    setDraft(buildDraftForNewSpell());
    setSaveOk(null);
    setError(null);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveOk(null);
    setError(null);
    try {
      const payload = {
        ...draft,
        flags: parseJsonOrNull(draft.flagsText || ""),
        tags: parseTags(draft.tagsText || ""),
        status_effect: parseJsonOrNull(draft.statusEffectText || ""),
        cleanse: parseJsonOrNull(draft.cleanseText || ""),
      };

      const res = await authedFetch(`/api/admin/spells`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const id = data?.spell?.id || payload.id;
      setSaveOk(`Saved: ${id}`);
      await load();
      setSelectedId(id);
      const refreshed = (data?.spell as AdminSpell | undefined) ||
        spells.find((s) => s.id === id);
      if (refreshed) setDraft(normalizeIncomingSpell(refreshed));
    } catch (e: any) {
      setError(explainAdminError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 16, display: "flex", gap: 16, width: "100%", maxWidth: 1280, margin: "0 auto", boxSizing: "border-box", justifyContent: "center", alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "0 0 420px", width: "100%", maxWidth: 420 }}>
        <h2 style={{ marginTop: 0 }}>Admin — Spells</h2>

        {capsError && (
          <div style={{
            border: "1px solid #a33",
            background: "#2a1111",
            padding: 12,
            borderRadius: 8,
            marginBottom: 12,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Admin capability check failed
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
              {capsError}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #333" }}
            placeholder="Search by id or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
          />
          <button onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button onClick={newSpell}>New</button>
        </div>

        {error && (
          <div
            style={{
              border: "1px solid #a33",
              background: "#2a1111",
              padding: 12,
              borderRadius: 8,
              marginBottom: 12,
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
            }}
          >
            {error}
          </div>
        )}

        {saveOk && (
          <div
            style={{
              border: "1px solid #3a3",
              background: "#112a11",
              padding: 12,
              borderRadius: 8,
              marginBottom: 12,
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
            }}
          >
            {saveOk}
          </div>
        )}

        <div style={{
          border: "1px solid #333",
          borderRadius: 8,
          overflow: "hidden",
        }}>
          <div
            style={{
              background: "#111",
              padding: 8,
              borderBottom: "1px solid #333",
              fontSize: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>Spells ({filtered.length})</div>
            <div style={{ opacity: 0.75 }}>click to edit</div>
          </div>
          <div style={{ maxHeight: "70vh", overflow: "auto" }}>
            {filtered.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: 10,
                  borderBottom: "1px solid #222",
                  cursor: "pointer",
                  background: selectedId === s.id ? "#1a1a1a" : "transparent",
                }}
                onClick={() => selectSpell(s.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>{s.name || s.id}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {s.is_enabled ? "enabled" : "disabled"}
                  </div>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.8 }}>
                  {s.id}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  kind={s.kind} · class={s.class_id || "any"} · lvl≥{s.min_level}
                  {s.is_song ? " · song" : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 520 }}>
        <h3 style={{ marginTop: 0 }}>Editor</h3>
        {!draft ? (
          <div style={{ opacity: 0.8 }}>
            Select a spell on the left (or hit <b>New</b>).
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
            <label>ID</label>
            <input
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
              placeholder="archmage_arcane_bolt"
            />

            <label>Name</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
            />

            <label>Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333", minHeight: 80 }}
            />

            <label>Kind</label>
            <input
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
              placeholder="spell | song | ability"
            />

            <label>Class ID</label>
            <input
              value={draft.class_id || ""}
              onChange={(e) =>
                setDraft({ ...draft, class_id: e.target.value.trim() ? e.target.value : null })
              }
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
              placeholder="archmage (empty = any)"
            />

            <label>Min Level</label>
            <input
              type="number"
              value={draft.min_level}
              onChange={(e) => setDraft({ ...draft, min_level: Number(e.target.value) })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
            />

            <label>School</label>
            <input
              value={draft.school}
              onChange={(e) => setDraft({ ...draft, school: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
            />

            <label>Song?</label>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={draft.is_song}
                  onChange={(e) => setDraft({ ...draft, is_song: e.target.checked })}
                />
                is_song
              </label>
              <input
                value={draft.song_school || ""}
                onChange={(e) =>
                  setDraft({ ...draft, song_school: e.target.value.trim() ? e.target.value : null })
                }
                style={{ padding: 8, borderRadius: 6, border: "1px solid #333", flex: 1 }}
                placeholder="song_school (optional)"
              />
            </div>

            <label>Resource</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={draft.resource_type}
                onChange={(e) => setDraft({ ...draft, resource_type: e.target.value })}
                style={{ padding: 8, borderRadius: 6, border: "1px solid #333", flex: 1 }}
                placeholder="mana | endurance | energy"
              />
              <input
                type="number"
                value={draft.resource_cost}
                onChange={(e) =>
                  setDraft({ ...draft, resource_cost: Number(e.target.value) })
                }
                style={{ padding: 8, borderRadius: 6, border: "1px solid #333", width: 140 }}
              />
            </div>

            <label>Cooldown (ms)</label>
            <input
              type="number"
              value={draft.cooldown_ms}
              onChange={(e) => setDraft({ ...draft, cooldown_ms: Number(e.target.value) })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
            />

            <label>Damage Mult</label>
            <input
              type="number"
              value={draft.damage_multiplier}
              onChange={(e) =>
                setDraft({ ...draft, damage_multiplier: Number(e.target.value) })
              }
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
            />

            <label>Flat Bonus</label>
            <input
              type="number"
              value={draft.flat_bonus}
              onChange={(e) => setDraft({ ...draft, flat_bonus: Number(e.target.value) })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
            />

            <label>Heal Amount</label>
            <input
              type="number"
              value={draft.heal_amount}
              onChange={(e) => setDraft({ ...draft, heal_amount: Number(e.target.value) })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
            />

            <label>Tags</label>
            <input
              value={draft.tagsText || ""}
              onChange={(e) => setDraft({ ...draft, tagsText: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333" }}
              placeholder="comma,separated,tags"
            />

            <label>Flags (json)</label>
            <textarea
              value={draft.flagsText || ""}
              onChange={(e) => setDraft({ ...draft, flagsText: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333", minHeight: 90, fontFamily: "monospace" }}
              placeholder='{\n  "allowTargeting": true\n}'
            />

            <label>Status Effect (json)</label>
            <textarea
              value={draft.statusEffectText || ""}
              onChange={(e) => setDraft({ ...draft, statusEffectText: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333", minHeight: 120, fontFamily: "monospace" }}
              placeholder='{\n  "id": "templar_aegis_of_light",\n  "durationMs": 60000\n}'
            />

            <label>Cleanse (json)</label>
            <textarea
              value={draft.cleanseText || ""}
              onChange={(e) => setDraft({ ...draft, cleanseText: e.target.value })}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #333", minHeight: 90, fontFamily: "monospace" }}
              placeholder='{\n  "mode": "remove",\n  "tags": ["poison"]\n}'
            />

            <label>Toggles</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={draft.is_enabled}
                  onChange={(e) => setDraft({ ...draft, is_enabled: e.target.checked })}
                />
                enabled
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={draft.is_debug}
                  onChange={(e) => setDraft({ ...draft, is_debug: e.target.checked })}
                />
                debug
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={draft.is_dev_only}
                  onChange={(e) => setDraft({ ...draft, is_dev_only: e.target.checked })}
                />
                dev_only
              </label>
            </div>

            <div />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              {draft.created_at && (
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  created: {draft.created_at}
                </div>
              )}
              {draft.updated_at && (
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  updated: {draft.updated_at}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
