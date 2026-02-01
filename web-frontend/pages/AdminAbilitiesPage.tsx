// web-frontend/pages/AdminAbilitiesPage.tsx
//
// Admin editor: Abilities catalog + unlock rules.
//
// Mirrors the general UX patterns of other admin pages:
// - Paged search list on left
// - Selected record editor on the right
// - Save via POST upsert
//
// Endpoints:
// - GET/POST /api/admin/abilities
// - GET/POST /api/admin/ability_unlocks

import * as React from "react";
import { api } from "../lib/api";

type TabId = "abilities" | "unlocks";

type AbilityRow = {
  id: string;
  name: string;
  description: string;
  kind: string;
  resource_type: string | null;
  resource_cost: number | null;
  cooldown_ms: number | null;
  is_enabled: boolean;
  is_debug: boolean;
  is_dev_only: boolean;
  grant_min_role: string;
  flags: any;
  tags: string;
  created_at?: string;
  updated_at?: string;
};

type UnlockRow = {
  class_id: string;
  ability_id: string;
  min_level: number;
  auto_grant: boolean;
  is_enabled: boolean;
  notes: string;
  created_at?: string;
  updated_at?: string;
};

function safeMsg(err: any): string {
  const m = String(err?.message ?? err ?? "").trim();
  return m || "Unknown error.";
}

function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const ui = {
  pageBg: "#ffffff",
  panelBg: "#ffffff",
  panelBorder: "#d8d8d8",
  subtleText: "rgba(0,0,0,0.65)",
  text: "#111111",
  inputBg: "#ffffff",
  inputBorder: "#c9c9c9",
  inputFocus: "#2a5bd7",
  btnBg: "#f3f3f3",
  btnBorder: "#d0d0d0",
  btnText: "#111111",
  btnPrimaryBg: "#2a5bd7",
  btnPrimaryBorder: "#2a5bd7",
  btnPrimaryText: "#ffffff",
  warnBg: "#fff6db",
  warnBorder: "#e3c45c",
  errorBg: "#ffe7e7",
  errorBorder: "#d25555",
};

function FieldLabel(props: { label: string; hint?: string }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: ui.text }}>{props.label}</div>
      {props.hint ? <div style={{ fontSize: 11, color: ui.subtleText }}>{props.hint}</div> : null}
    </div>
  );
}

function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "8px 10px",
        borderRadius: 10,
        border: `1px solid ${ui.inputBorder}`,
        background: ui.inputBg,
        color: ui.text,
        fontFamily: props.mono
          ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
          : undefined,
        fontSize: 13,
        boxSizing: "border-box",
        outline: "none",
      }}
    />
  );
}

function TextArea(props: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={props.value}
      rows={props.rows ?? 5}
      onChange={(e) => props.onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "8px 10px",
        borderRadius: 10,
        border: `1px solid ${ui.inputBorder}`,
        background: ui.inputBg,
        color: ui.text,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
        resize: "vertical",
        boxSizing: "border-box",
        outline: "none",
      }}
    />
  );
}

function Checkbox(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", color: ui.text }}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} style={{ transform: "scale(1.15)" }} />
      <span style={{ fontSize: 13 }}>{props.label}</span>
    </label>
  );
}

function PillButton(props: { onClick: () => void; children: React.ReactNode; kind?: "primary" | "default" | "danger" }) {
  const kind = props.kind ?? "default";
  const bg = kind === "primary" ? ui.btnPrimaryBg : kind === "danger" ? "#d25555" : ui.btnBg;
  const border = kind === "primary" ? ui.btnPrimaryBorder : kind === "danger" ? "#d25555" : ui.btnBorder;
  const text = kind === "primary" ? ui.btnPrimaryText : kind === "danger" ? "#ffffff" : ui.btnText;

  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        border: `1px solid ${border}`,
        background: bg,
        color: text,
        padding: "8px 12px",
        borderRadius: 999,
        cursor: "pointer",
        fontWeight: 800,
        fontSize: 12,
      }}
    >
      {props.children}
    </button>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "#e7e7e7", margin: "10px 0" }} />;
}

export function AdminAbilitiesPage() {
  const [tab, setTab] = React.useState<TabId>("abilities");

  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<any[]>([]);
  const [total, setTotal] = React.useState(0);
  const [limit, setLimit] = React.useState(50);
  const [offset, setOffset] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string>("");

  const [selectedAbilityId, setSelectedAbilityId] = React.useState<string>("");
  const [abilityDraft, setAbilityDraft] = React.useState<AbilityRow | null>(null);
  const [abilityDirty, setAbilityDirty] = React.useState(false);

  const [unlockClassId, setUnlockClassId] = React.useState<string>("");
  const [unlockAbilityId, setUnlockAbilityId] = React.useState<string>("");
  const [selectedUnlockKey, setSelectedUnlockKey] = React.useState<string>("");
  const [unlockDraft, setUnlockDraft] = React.useState<UnlockRow | null>(null);
  const [unlockDirty, setUnlockDirty] = React.useState(false);

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const qp = new URLSearchParams();
      if (q.trim()) qp.set("q", q.trim());
      qp.set("limit", String(limit));
      qp.set("offset", String(offset));

      if (tab === "unlocks") {
        if (unlockClassId.trim()) qp.set("classId", unlockClassId.trim());
        if (unlockAbilityId.trim()) qp.set("abilityId", unlockAbilityId.trim());
      }

      const url = tab === "abilities" ? `/api/admin/abilities?${qp.toString()}` : `/api/admin/ability_unlocks?${qp.toString()}`;
      const j = await api(url);
      if (!j?.ok) throw new Error(j?.error || "request_failed");

      setItems(j.items || []);
      setTotal(Number(j.total || 0));
    } catch (e: any) {
      setErr(safeMsg(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, limit, offset]);

  function selectAbility(row: AbilityRow) {
    setSelectedAbilityId(row.id);
    setAbilityDraft(jsonClone(row));
    setAbilityDirty(false);
    setSelectedUnlockKey("");
  }

  function newAbility() {
    const id = "new_ability_id";
    const row: AbilityRow = {
      id,
      name: id,
      description: "",
      kind: "",
      resource_type: null,
      resource_cost: null,
      cooldown_ms: null,
      is_enabled: true,
      is_debug: false,
      is_dev_only: false,
      grant_min_role: "player",
      flags: {},
      tags: "",
    };
    setSelectedAbilityId(id);
    setAbilityDraft(row);
    setAbilityDirty(true);
  }

  async function saveAbility() {
    if (!abilityDraft) return;
    setLoading(true);
    setErr("");
    try {
      const j = await api(`/api/admin/abilities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(abilityDraft),
      });
      if (!j?.ok) throw new Error(j?.error || "save_failed");
      const saved: AbilityRow = j.item;
      setAbilityDraft(jsonClone(saved));
      setSelectedAbilityId(saved.id);
      setAbilityDirty(false);
      await refresh();
    } catch (e: any) {
      setErr(safeMsg(e));
    } finally {
      setLoading(false);
    }
  }

  function selectUnlock(row: UnlockRow) {
    const key = `${row.class_id}::${row.ability_id}`;
    setSelectedUnlockKey(key);
    setUnlockDraft(jsonClone(row));
    setUnlockDirty(false);
    setSelectedAbilityId("");
  }

  function newUnlock() {
    const row: UnlockRow = {
      class_id: unlockClassId.trim() || "warrior",
      ability_id: unlockAbilityId.trim() || "power_strike",
      min_level: 1,
      auto_grant: true,
      is_enabled: true,
      notes: "",
    };
    const key = `${row.class_id}::${row.ability_id}`;
    setSelectedUnlockKey(key);
    setUnlockDraft(row);
    setUnlockDirty(true);
  }

  async function saveUnlock() {
    if (!unlockDraft) return;
    setLoading(true);
    setErr("");
    try {
      const j = await api(`/api/admin/ability_unlocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unlockDraft),
      });
      if (!j?.ok) throw new Error(j?.error || "save_failed");
      const saved: UnlockRow = j.item;
      setUnlockDraft(jsonClone(saved));
      setSelectedUnlockKey(`${saved.class_id}::${saved.ability_id}`);
      setUnlockDirty(false);
      await refresh();
    } catch (e: any) {
      setErr(safeMsg(e));
    } finally {
      setLoading(false);
    }
  }

  const pageTitle = tab === "abilities" ? "Abilities" : "Ability Unlocks";

  return (
    <section style={{ display: "grid", gap: 12, padding: 12, background: ui.pageBg, color: ui.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h2 style={{ margin: 0 }}>{pageTitle}</h2>
          <div style={{ fontSize: 12, color: ui.subtleText }}>
            Admin editor for ability metadata + unlock rules. Mechanics are still code-defined (for now).
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <PillButton onClick={() => setTab("abilities")} kind={tab === "abilities" ? "primary" : "default"}>
            Catalog
          </PillButton>
          <PillButton onClick={() => setTab("unlocks")} kind={tab === "unlocks" ? "primary" : "default"}>
            Unlock Rules
          </PillButton>
          <PillButton onClick={() => refresh()}>{loading ? "Refreshing..." : "Refresh"}</PillButton>
        </div>
      </div>

      {err ? (
        <div style={{ border: `1px solid ${ui.errorBorder}`, background: ui.errorBg, padding: 10, borderRadius: 12, color: "#7a1010" }}>
          <b>Error:</b> {err}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 12, alignItems: "start" }}>
        <div style={{ border: `1px solid ${ui.panelBorder}`, borderRadius: 14, background: ui.panelBg, padding: 12 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <FieldLabel label="Search" hint="Matches id/name/description/tags (abilities) or class_id/ability_id/notes (unlocks)" />
              <TextInput value={q} onChange={(v) => setQ(v)} placeholder="q..." mono />
            </div>

            {tab === "unlocks" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <FieldLabel label="Filter: classId" hint="Optional" />
                  <TextInput value={unlockClassId} onChange={(v) => setUnlockClassId(v)} placeholder="warrior" mono />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <FieldLabel label="Filter: abilityId" hint="Optional" />
                  <TextInput value={unlockAbilityId} onChange={(v) => setUnlockAbilityId(v)} placeholder="power_strike" mono />
                </div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <PillButton
                onClick={() => {
                  setOffset(0);
                  void refresh();
                }}
                kind="primary"
              >
                Search
              </PillButton>

              {tab === "abilities" ? <PillButton onClick={() => newAbility()}>New Ability</PillButton> : <PillButton onClick={() => newUnlock()}>New Rule</PillButton>}
            </div>

            <div style={{ fontSize: 12, color: ui.subtleText }}>
              Showing <b>{items.length}</b> of <b>{total}</b>
            </div>

            <Divider />

            <div style={{ display: "grid", gap: 8 }}>
              {items.map((row: any) => {
                const key = tab === "abilities" ? String(row.id) : `${row.class_id}::${row.ability_id}`;
                const active = tab === "abilities" ? key === selectedAbilityId : key === selectedUnlockKey;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => (tab === "abilities" ? selectAbility(row as AbilityRow) : selectUnlock(row as UnlockRow))}
                    style={{
                      textAlign: "left",
                      border: active ? `1px solid ${ui.inputFocus}` : `1px solid ${ui.panelBorder}`,
                      background: active ? "#eef4ff" : "#fafafa",
                      color: ui.text,
                      borderRadius: 12,
                      padding: 10,
                      cursor: "pointer",
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{tab === "abilities" ? row.id : `${row.class_id} → ${row.ability_id}`}</div>
                    {tab === "abilities" ? (
                      <div style={{ fontSize: 12, color: ui.subtleText }}>{row.name}</div>
                    ) : (
                      <div style={{ fontSize: 12, color: ui.subtleText }}>
                        minLevel={row.min_level} • autoGrant={String(row.auto_grant)} • enabled={String(row.is_enabled)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <Divider />

            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <PillButton onClick={() => setOffset(Math.max(0, offset - limit))}>&larr; Prev</PillButton>
              <div style={{ fontSize: 12, color: ui.subtleText }}>
                offset=<code>{offset}</code>
              </div>
              <PillButton onClick={() => setOffset(offset + limit)}>Next &rarr;</PillButton>
            </div>
          </div>
        </div>

        <div style={{ border: `1px solid ${ui.panelBorder}`, borderRadius: 14, background: ui.panelBg, padding: 14 }}>
          {tab === "abilities" ? (
            !abilityDraft ? (
              <div style={{ color: ui.subtleText }}>Select an ability on the left (or create a new one).</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: ui.subtleText }}>
                    Editing: <code>{selectedAbilityId || abilityDraft.id}</code>{" "}
                    {abilityDirty ? <span style={{ color: "#8a5b00", marginLeft: 8 }}>(unsaved)</span> : null}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <PillButton onClick={() => saveAbility()} kind="primary">
                      Save
                    </PillButton>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <FieldLabel label="id" hint="Primary key. Keep stable; used by unlock rules + code." />
                  <TextInput
                    value={abilityDraft.id}
                    onChange={(v) => {
                      setAbilityDraft({ ...abilityDraft, id: v });
                      setAbilityDirty(true);
                    }}
                    mono
                  />

                  <FieldLabel label="name" />
                  <TextInput
                    value={abilityDraft.name}
                    onChange={(v) => {
                      setAbilityDraft({ ...abilityDraft, name: v });
                      setAbilityDirty(true);
                    }}
                  />

                  <FieldLabel label="kind" hint="Optional classification (UI grouping / future balance knobs)." />
                  <TextInput
                    value={abilityDraft.kind}
                    onChange={(v) => {
                      setAbilityDraft({ ...abilityDraft, kind: v });
                      setAbilityDirty(true);
                    }}
                    mono
                  />

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <FieldLabel label="resource_type" hint="Optional" />
                      <TextInput
                        value={abilityDraft.resource_type ?? ""}
                        onChange={(v) => {
                          setAbilityDraft({ ...abilityDraft, resource_type: v.trim() ? v : null });
                          setAbilityDirty(true);
                        }}
                        mono
                      />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <FieldLabel label="resource_cost" hint="Optional" />
                      <TextInput
                        value={abilityDraft.resource_cost == null ? "" : String(abilityDraft.resource_cost)}
                        onChange={(v) => {
                          const n = v.trim() ? Number(v) : null;
                          setAbilityDraft({ ...abilityDraft, resource_cost: Number.isFinite(n as any) ? (n as any) : null });
                          setAbilityDirty(true);
                        }}
                        mono
                      />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <FieldLabel label="cooldown_ms" hint="Optional" />
                      <TextInput
                        value={abilityDraft.cooldown_ms == null ? "" : String(abilityDraft.cooldown_ms)}
                        onChange={(v) => {
                          const n = v.trim() ? Number(v) : null;
                          setAbilityDraft({ ...abilityDraft, cooldown_ms: Number.isFinite(n as any) ? (n as any) : null });
                          setAbilityDirty(true);
                        }}
                        mono
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <Checkbox
                      checked={abilityDraft.is_enabled}
                      onChange={(v) => {
                        setAbilityDraft({ ...abilityDraft, is_enabled: v });
                        setAbilityDirty(true);
                      }}
                      label="is_enabled"
                    />
                    <Checkbox
                      checked={abilityDraft.is_debug}
                      onChange={(v) => {
                        setAbilityDraft({ ...abilityDraft, is_debug: v });
                        setAbilityDirty(true);
                      }}
                      label="is_debug"
                    />
                    <Checkbox
                      checked={abilityDraft.is_dev_only}
                      onChange={(v) => {
                        setAbilityDraft({ ...abilityDraft, is_dev_only: v });
                        setAbilityDirty(true);
                      }}
                      label="is_dev_only"
                    />
                  </div>

                  <FieldLabel label="grant_min_role" hint="Default 'player'. (Future: role gating.)" />
                  <TextInput
                    value={abilityDraft.grant_min_role}
                    onChange={(v) => {
                      setAbilityDraft({ ...abilityDraft, grant_min_role: v });
                      setAbilityDirty(true);
                    }}
                    mono
                  />

                  <FieldLabel label="tags" hint="Freeform string (searchable)." />
                  <TextInput
                    value={abilityDraft.tags}
                    onChange={(v) => {
                      setAbilityDraft({ ...abilityDraft, tags: v });
                      setAbilityDirty(true);
                    }}
                  />

                  <FieldLabel label="description" />
                  <TextArea
                    value={abilityDraft.description}
                    rows={6}
                    onChange={(v) => {
                      setAbilityDraft({ ...abilityDraft, description: v });
                      setAbilityDirty(true);
                    }}
                  />

                  <FieldLabel label="flags (json)" hint="Stored as jsonb. Keep small + intentional." />
                  <TextArea
                    value={JSON.stringify(abilityDraft.flags ?? {}, null, 2)}
                    rows={10}
                    onChange={(v) => {
                      try {
                        const parsed = JSON.parse(v || "{}");
                        setAbilityDraft({ ...abilityDraft, flags: parsed });
                        setAbilityDirty(true);
                      } catch {
                        // ignore until corrected
                      }
                    }}
                  />
                </div>
              </div>
            )
          ) : !unlockDraft ? (
            <div style={{ color: ui.subtleText }}>Select an unlock rule on the left (or create a new one).</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: ui.subtleText }}>
                  Editing: <code>{selectedUnlockKey || `${unlockDraft.class_id}::${unlockDraft.ability_id}`}</code>{" "}
                  {unlockDirty ? <span style={{ color: "#8a5b00", marginLeft: 8 }}>(unsaved)</span> : null}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <PillButton onClick={() => saveUnlock()} kind="primary">
                    Save
                  </PillButton>
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <FieldLabel label="class_id" hint="Primary key part. 'any' applies to all classes." />
                <TextInput
                  value={unlockDraft.class_id}
                  onChange={(v) => {
                    setUnlockDraft({ ...unlockDraft, class_id: v });
                    setUnlockDirty(true);
                  }}
                  mono
                />

                <FieldLabel label="ability_id" hint="Primary key part. Must match an ability id (catalog or code-defined)." />
                <TextInput
                  value={unlockDraft.ability_id}
                  onChange={(v) => {
                    setUnlockDraft({ ...unlockDraft, ability_id: v });
                    setUnlockDirty(true);
                  }}
                  mono
                />

                <FieldLabel label="min_level" />
                <TextInput
                  value={String(unlockDraft.min_level)}
                  onChange={(v) => {
                    const n = Number(v);
                    setUnlockDraft({ ...unlockDraft, min_level: Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : 1 });
                    setUnlockDirty(true);
                  }}
                  mono
                />

                <div style={{ display: "grid", gap: 8 }}>
                  <Checkbox
                    checked={unlockDraft.auto_grant}
                    onChange={(v) => {
                      setUnlockDraft({ ...unlockDraft, auto_grant: v });
                      setUnlockDirty(true);
                    }}
                    label="auto_grant (true=auto known; false=trainable)"
                  />
                  <Checkbox
                    checked={unlockDraft.is_enabled}
                    onChange={(v) => {
                      setUnlockDraft({ ...unlockDraft, is_enabled: v });
                      setUnlockDirty(true);
                    }}
                    label="is_enabled"
                  />
                </div>

                <FieldLabel label="notes" />
                <TextArea
                  value={unlockDraft.notes}
                  rows={6}
                  onChange={(v) => {
                    setUnlockDraft({ ...unlockDraft, notes: v });
                    setUnlockDirty(true);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
