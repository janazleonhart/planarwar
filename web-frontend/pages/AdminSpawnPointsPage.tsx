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

// Mother Brain admin responses (kept structural on purpose)
type MotherBrainListRow = {
  spawnId: string;
  type: string;
  protoId: string | null;
  regionId: string | null;
};

type MotherBrainStatusResponse = {
  ok: boolean;
  shardId: string;
  bounds: string;
  cellSize: number;
  theme: string | null;
  epoch: number | null;
  total: number;
  box?: { minX: number; maxX: number; minZ: number; maxZ: number };
  byTheme?: Record<string, number>;
  byEpoch?: Record<string, number>;
  byType?: Record<string, number>;
  topProto?: Record<string, number>;
  list?: MotherBrainListRow[];
  error?: string;
};

type MotherBrainWaveResponse = {
  ok: boolean;
  commit: boolean;
  append: boolean;
  wouldInsert?: number;
  wouldDelete?: number;
  inserted?: number;
  deleted?: number;
  error?: string;
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

function SmallKeyValue(props: { title: string; map?: Record<string, number> }) {
  const entries = Object.entries(props.map ?? {});
  const hasAny = entries.length > 0;

  return (
    <div style={{ fontFamily: "monospace", fontSize: 12 }}>
      <div style={{ opacity: 0.85 }}>
        <b>{props.title}</b>:{" "}
        {!hasAny ? <span>(none)</span> : <span>({entries.length})</span>}
      </div>
      {hasAny && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {entries
            .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
            .slice(0, 16)
            .map(([k, v]) => (
              <span key={k} style={{ opacity: 0.95 }}>
                {k}={v}
              </span>
            ))}
        </div>
      )}
    </div>
  );
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

  // Mother Brain (status)
  const [mbBounds, setMbBounds] = useState("-1..1,-1..1");
  const [mbCellSize, setMbCellSize] = useState(64);
  const [mbTheme, setMbTheme] = useState<string>("");
  const [mbEpoch, setMbEpoch] = useState<string>("");
  const [mbLimit, setMbLimit] = useState(15);
  const [mbStatus, setMbStatus] = useState<MotherBrainStatusResponse | null>(null);
  const [mbStatusLoading, setMbStatusLoading] = useState(false);

  // Mother Brain (wave)
  const [waveTheme, setWaveTheme] = useState("goblins");
  const [waveEpoch, setWaveEpoch] = useState(0);
  const [waveCount, setWaveCount] = useState(8);
  const [waveSeed, setWaveSeed] = useState("seed:mother");
  const [waveAppend, setWaveAppend] = useState(false);
  const [waveLoading, setWaveLoading] = useState(false);
  const [waveResult, setWaveResult] = useState<MotherBrainWaveResponse | null>(null);

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

  const runMotherBrainStatus = async (withList: boolean) => {
    setMbStatusLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("shardId", shardId.trim() || "prime_shard");
      qs.set("bounds", mbBounds.trim() || "-1..1,-1..1");
      qs.set("cellSize", String(Number(mbCellSize) || 64));
      if (mbTheme.trim()) qs.set("theme", mbTheme.trim());
      if (mbEpoch.trim()) qs.set("epoch", mbEpoch.trim());
      if (withList) {
        qs.set("list", "1");
        qs.set("limit", String(Number(mbLimit) || 15));
      }

      const url = `${ADMIN_API_BASE}/api/admin/spawn_points/mother_brain/status?${qs.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MotherBrain status failed (HTTP ${res.status})`);
      const data: MotherBrainStatusResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "MotherBrain status failed");
      setMbStatus(data);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setMbStatusLoading(false);
    }
  };

  const runMotherBrainWave = async (commit: boolean) => {
    setWaveLoading(true);
    setError(null);
    try {
      const url = `${ADMIN_API_BASE}/api/admin/spawn_points/mother_brain/wave`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          bounds: mbBounds.trim() || "-1..1,-1..1",
          cellSize: Number(mbCellSize) || 64,
          epoch: Number(waveEpoch) || 0,
          theme: waveTheme.trim() || "goblins",
          count: Number(waveCount) || 8,
          seed: waveSeed.trim() || "seed:mother",
          append: !!waveAppend,
          commit: !!commit,
        }),
      });

      if (!res.ok) throw new Error(`MotherBrain wave failed (HTTP ${res.status})`);
      const data: MotherBrainWaveResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "MotherBrain wave failed");
      setWaveResult(data);

      // Refresh status + reload list so it feels immediate.
      await runMotherBrainStatus(false);
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setWaveLoading(false);
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
    if (sp) setForm({ ...sp });
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

    if (!canEditSpawn(form.spawnId)) {
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
          id: form.id > 0 ? form.id : null,
        }),
      });

      let payload: { ok?: boolean; error?: string; id?: number | null } = {};
      try {
        payload = await res.json();
      } catch {
        // ignore parse errors
      }

      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || `Save failed (HTTP ${res.status})`);
      }

      await load();

      if (!selectedId && payload.id && typeof payload.id === "number") {
        setSelectedId(payload.id);
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
        {/* Left: list + mother brain panels */}
        <div style={{ minWidth: 320 }}>
          <div
            style={{
              border: "1px solid #333",
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <h2 style={{ margin: "0 0 8px 0" }}>Mother Brain</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Bounds</span>
                <input
                  value={mbBounds}
                  onChange={(e) => setMbBounds(e.target.value)}
                  placeholder="-1..1,-1..1"
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Cell Size</span>
                <input
                  type="number"
                  value={mbCellSize}
                  onChange={(e) => setMbCellSize(Number(e.target.value) || 0)}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Theme (optional)</span>
                <input
                  value={mbTheme}
                  onChange={(e) => setMbTheme(e.target.value)}
                  placeholder="(any)"
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Epoch (optional)</span>
                <input
                  value={mbEpoch}
                  onChange={(e) => setMbEpoch(e.target.value)}
                  placeholder="(any)"
                />
              </label>
              <label style={{ display: "grid", gap: 4, gridColumn: "1 / span 2" }}>
                <span style={{ opacity: 0.8 }}>List Limit</span>
                <input
                  type="number"
                  value={mbLimit}
                  onChange={(e) => setMbLimit(Number(e.target.value) || 0)}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button disabled={mbStatusLoading} onClick={() => void runMotherBrainStatus(false)}>
                {mbStatusLoading ? "Loading..." : "Status"}
              </button>
              <button disabled={mbStatusLoading} onClick={() => void runMotherBrainStatus(true)}>
                {mbStatusLoading ? "Loading..." : "Status + List"}
              </button>
            </div>

            {mbStatus && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9 }}>
                  <div>
                    <b>Total</b>: {mbStatus.total ?? 0}
                  </div>
                  {mbStatus.box && (
                    <div>
                      box_x={mbStatus.box.minX}..{mbStatus.box.maxX} box_z=
                      {mbStatus.box.minZ}..{mbStatus.box.maxZ}
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <SmallKeyValue title="byTheme" map={mbStatus.byTheme} />
                  <SmallKeyValue title="byEpoch" map={mbStatus.byEpoch} />
                  <SmallKeyValue title="byType" map={mbStatus.byType} />
                  <SmallKeyValue title="topProto" map={mbStatus.topProto} />
                </div>

                {mbStatus.list && mbStatus.list.length > 0 && (
                  <div style={{ borderTop: "1px solid #333", paddingTop: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>List</div>
                    <div style={{ maxHeight: 220, overflow: "auto" }}>
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: 12,
                        }}
                      >
                        <thead>
                          <tr>
                            <th
                              style={{
                                textAlign: "left",
                                borderBottom: "1px solid #333",
                                padding: "4px 6px",
                              }}
                            >
                              spawnId
                            </th>
                            <th
                              style={{
                                textAlign: "left",
                                borderBottom: "1px solid #333",
                                padding: "4px 6px",
                              }}
                            >
                              type
                            </th>
                            <th
                              style={{
                                textAlign: "left",
                                borderBottom: "1px solid #333",
                                padding: "4px 6px",
                              }}
                            >
                              proto
                            </th>
                            <th
                              style={{
                                textAlign: "left",
                                borderBottom: "1px solid #333",
                                padding: "4px 6px",
                              }}
                            >
                              region
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {mbStatus.list.map((r) => (
                            <tr key={r.spawnId}>
                              <td
                                style={{
                                  borderBottom: "1px solid #222",
                                  padding: "4px 6px",
                                  fontFamily: "monospace",
                                }}
                              >
                                {r.spawnId}
                              </td>
                              <td style={{ borderBottom: "1px solid #222", padding: "4px 6px" }}>
                                {r.type}
                              </td>
                              <td style={{ borderBottom: "1px solid #222", padding: "4px 6px" }}>
                                {r.protoId ?? ""}
                              </td>
                              <td style={{ borderBottom: "1px solid #222", padding: "4px 6px" }}>
                                {r.regionId ?? ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ borderTop: "1px solid #333", marginTop: 12, paddingTop: 12 }}>
              <h3 style={{ margin: "0 0 8px 0" }}>Wave</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Theme</span>
                  <input value={waveTheme} onChange={(e) => setWaveTheme(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Epoch</span>
                  <input
                    type="number"
                    value={waveEpoch}
                    onChange={(e) => setWaveEpoch(Number(e.target.value) || 0)}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Count</span>
                  <input
                    type="number"
                    value={waveCount}
                    onChange={(e) => setWaveCount(Number(e.target.value) || 0)}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Seed</span>
                  <input value={waveSeed} onChange={(e) => setWaveSeed(e.target.value)} />
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    gridColumn: "1 / span 2",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={waveAppend}
                    onChange={(e) => setWaveAppend(e.target.checked)}
                  />
                  <span>Append (do not delete existing brain spawns in bounds)</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button disabled={waveLoading} onClick={() => void runMotherBrainWave(false)}>
                  {waveLoading ? "Working..." : "Plan (dry-run)"}
                </button>
                <button disabled={waveLoading} onClick={() => void runMotherBrainWave(true)}>
                  {waveLoading ? "Working..." : "Commit"}
                </button>
              </div>

              {waveResult && (
                <pre
                  style={{
                    marginTop: 10,
                    background: "#111",
                    border: "1px solid #333",
                    padding: 8,
                    borderRadius: 6,
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(waveResult, null, 2)}
                </pre>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
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
                    <span style={{ fontSize: 12, opacity: 0.8 }}>[{auth}]</span>
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

        {/* Right: spawn point form */}
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
                      updateField("townTier", e.target.value === "" ? null : Number(e.target.value))
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
