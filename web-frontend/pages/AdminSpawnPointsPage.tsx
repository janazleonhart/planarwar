// web-frontend/pages/AdminSpawnPointsPage.tsx

import { useEffect, useState } from "react";

const ADMIN_API_BASE = "http://192.168.0.74:4000";

type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";

type AdminSpawnPoint = {
  id: number;

  shardId: string;
  spawnId: string;

  type: string;
  archetype: string;

  protoId: string | null;
  variantId: string | null;

  x: number | null;
  y: number | null;
  z: number | null;

  regionId: string | null;
  townTier: number | null;

  authority?: SpawnAuthority;
};

function getAuthority(spawnId: string): SpawnAuthority {
  const s = String(spawnId ?? "").trim().toLowerCase();
  if (s.startsWith("anchor:")) return "anchor";
  if (s.startsWith("seed:")) return "seed";
  if (s.startsWith("brain:")) return "brain";
  return "manual";
}

function canEditSpawn(spawnId: string): boolean {
  return getAuthority(spawnId) !== "brain";
}

export function AdminSpawnPointsPage() {
  const [spawnPoints, setSpawnPoints] = useState<AdminSpawnPoint[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<AdminSpawnPoint | null>(null);

  const [shardId, setShardId] = useState("prime_shard");
  const [regionId, setRegionId] = useState("prime_shard:0,0");

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${ADMIN_API_BASE}/api/admin/spawn_points?shardId=${encodeURIComponent(
        shardId.trim() || "prime_shard"
      )}&regionId=${encodeURIComponent(regionId.trim())}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);

      const data: { ok: boolean; spawnPoints: AdminSpawnPoint[]; error?: string } =
        await res.json();

      if (!data.ok) throw new Error(data.error || "Failed to load spawn points");

      const normalized = (data.spawnPoints ?? []).map((p) => ({
        ...p,
        authority: p.authority ?? getAuthority(p.spawnId),
      }));

      setSpawnPoints(normalized);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  // initial load
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selecting a spawn point, populate form
  useEffect(() => {
    if (selectedId == null) {
      setForm(null);
      return;
    }
    const sp = spawnPoints.find((x) => x.id === selectedId);
    if (sp) {
      setForm({ ...sp });
    }
  }, [selectedId, spawnPoints]);

  const startNew = () => {
    setSelectedId(null);
    setForm({
      id: 0,
      shardId: shardId.trim() || "prime_shard",
      spawnId: "",
      type: "npc",
      archetype: "npc",
      protoId: "",
      variantId: null,
      x: 0,
      y: 0,
      z: 0,
      regionId: regionId.trim() || null,
      townTier: null,
      authority: "manual",
    });
  };

  const updateField = <K extends keyof AdminSpawnPoint>(
    key: K,
    value: AdminSpawnPoint[K]
  ) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!form) return;

    const editable = canEditSpawn(form.spawnId);
    if (!editable) {
      setError("This spawn point is brain-owned (brain:*) and is read-only here.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/spawn_points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          // backend treats id missing/0 as insert
          id: form.id > 0 ? form.id : null,
        }),
      });

      let payload: { ok?: boolean; error?: string; id?: number | null } = {};
      try {
        payload = await res.json();
      } catch {
        // ignore parse errors; fall back to HTTP status
      }

      if (!res.ok || payload.ok === false) {
        const msg = payload.error || `Save failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      await load();

      if (!selectedId && payload.id && typeof payload.id === "number") {
        setSelectedId(payload.id);
      } else if (selectedId) {
        // reselect current
        setSelectedId(selectedId);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>Spawn Points Editor (v0)</h1>

      {error && (
        <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>
      )}

      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>
          Shard:
          <input
            style={{ width: 160, marginLeft: 6 }}
            value={shardId}
            onChange={(e) => setShardId(e.target.value)}
          />
        </label>
        <label>
          Region:
          <input
            style={{ width: 220, marginLeft: 6 }}
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
          />
        </label>
        <button onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Load"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: list */}
        <div style={{ minWidth: 320 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <strong>Spawn Points in DB</strong>
            <button onClick={startNew}>New</button>
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {spawnPoints.map((sp) => {
              const auth = sp.authority ?? getAuthority(sp.spawnId);
              const selected = sp.id === selectedId;

              return (
                <li
                  key={sp.id}
                  style={{
                    padding: 6,
                    marginBottom: 4,
                    border: selected ? "2px solid #4caf50" : "1px solid #ccc",
                    borderRadius: 4,
                    cursor: "pointer",
                    opacity: auth === "brain" ? 0.75 : 1,
                  }}
                  onClick={() => setSelectedId(sp.id)}
                >
                  <div>
                    <strong>{sp.type}</strong>{" "}
                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                      [{auth}]
                    </span>
                  </div>
                  <div style={{ fontSize: 12 }}>
                    <code>{sp.spawnId}</code>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    proto: <code>{sp.protoId ?? "(null)"}</code>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {sp.regionId ? (
                      <>
                        region: <code>{sp.regionId}</code> •{" "}
                      </>
                    ) : null}
                    pos: ({sp.x ?? "?"}, {sp.y ?? "?"}, {sp.z ?? "?"})
                  </div>
                </li>
              );
            })}

            {spawnPoints.length === 0 && <li>No spawn points returned.</li>}
          </ul>
        </div>

        {/* Right: form */}
        <div style={{ flex: 1 }}>
          {form ? (
            <div style={{ border: "1px solid #ccc", borderRadius: 4, padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
                Tip: use spawnId prefixes <code>anchor:</code> or <code>seed:</code>.{" "}
                <code>brain:</code> is read-only here.
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  DB ID:
                  <input style={{ width: "100%" }} value={form.id || ""} disabled />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  ShardId:
                  <input
                    style={{ width: "100%" }}
                    value={form.shardId}
                    onChange={(e) => updateField("shardId", e.target.value)}
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  SpawnId:
                  <input
                    style={{ width: "100%" }}
                    value={form.spawnId}
                    onChange={(e) => updateField("spawnId", e.target.value)}
                    disabled={!canEditSpawn(form.spawnId)}
                    placeholder="anchor:starter_hub_guard_1   OR   seed:goblin_camp_0"
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <label>
                  Type:
                  <input
                    style={{ width: 140, marginLeft: 6 }}
                    value={form.type}
                    onChange={(e) => updateField("type", e.target.value)}
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
                <label>
                  Archetype:
                  <input
                    style={{ width: 140, marginLeft: 6 }}
                    value={form.archetype}
                    onChange={(e) => updateField("archetype", e.target.value)}
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
                <label>
                  Town Tier (optional):
                  <input
                    type="number"
                    style={{ width: 120, marginLeft: 6 }}
                    value={form.townTier ?? ""}
                    onChange={(e) =>
                      updateField(
                        "townTier",
                        e.target.value === "" ? null : Number(e.target.value)
                      )
                    }
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  ProtoId:
                  <input
                    style={{ width: "100%" }}
                    value={form.protoId ?? ""}
                    onChange={(e) => updateField("protoId", e.target.value)}
                    disabled={!canEditSpawn(form.spawnId)}
                    placeholder="town_rat / ore_vein_small1 / station_forge / etc"
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  VariantId (optional):
                  <input
                    style={{ width: "100%" }}
                    value={form.variantId ?? ""}
                    onChange={(e) => updateField("variantId", e.target.value)}
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label>
                  RegionId:
                  <input
                    style={{ width: "100%" }}
                    value={form.regionId ?? ""}
                    onChange={(e) => updateField("regionId", e.target.value)}
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <label>
                  X:
                  <input
                    type="number"
                    style={{ width: 120, marginLeft: 6 }}
                    value={form.x ?? ""}
                    onChange={(e) =>
                      updateField("x", e.target.value === "" ? null : Number(e.target.value))
                    }
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
                <label>
                  Y:
                  <input
                    type="number"
                    style={{ width: 120, marginLeft: 6 }}
                    value={form.y ?? ""}
                    onChange={(e) =>
                      updateField("y", e.target.value === "" ? null : Number(e.target.value))
                    }
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
                <label>
                  Z:
                  <input
                    type="number"
                    style={{ width: 120, marginLeft: 6 }}
                    value={form.z ?? ""}
                    onChange={(e) =>
                      updateField("z", e.target.value === "" ? null : Number(e.target.value))
                    }
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={handleSave} disabled={saving || !canEditSpawn(form.spawnId)}>
                  {saving ? "Saving..." : "Save Spawn Point"}
                </button>
                <button type="button" onClick={startNew} disabled={saving}>
                  Clear / New
                </button>
              </div>
            </div>
          ) : (
            <div>Select a spawn point or click “New”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
