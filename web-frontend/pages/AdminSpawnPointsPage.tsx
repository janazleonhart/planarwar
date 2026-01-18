// web-frontend/pages/AdminSpawnPointsPage.tsx

import { useEffect, useMemo, useState } from "react";

const ADMIN_API_BASE = "http://192.168.0.74:4000";

type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";
type LoadMode = "region" | "radius" | "recent";

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
        <b>{props.title}</b>: {!hasAny ? <span>(none)</span> : <span>({entries.length})</span>}
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

  // Load controls
  const [loadMode, setLoadMode] = useState<LoadMode>("region");
  const [regionId, setRegionId] = useState("prime_shard:0,0");
  const [queryX, setQueryX] = useState(0);
  const [queryZ, setQueryZ] = useState(0);
  const [queryRadius, setQueryRadius] = useState(500);

  // Filters
  const [filterAuthority, setFilterAuthority] = useState<string>("");
  const [filterType, setFilterType] = useState("");
  const [filterArchetype, setFilterArchetype] = useState("");
  const [filterProtoId, setFilterProtoId] = useState("");
  const [filterSpawnId, setFilterSpawnId] = useState("");
  const [limit, setLimit] = useState(200);

  // Bulk selection + ops
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkDx, setBulkDx] = useState(0);
  const [bulkDy, setBulkDy] = useState(0);
  const [bulkDz, setBulkDz] = useState(0);
  const [bulkWorking, setBulkWorking] = useState(false);

  // Clone / Scatter (System 3 MVP)
  const [whereamiPaste, setWhereamiPaste] = useState("");

  // Clone selected
  const [cloneCountPerId, setCloneCountPerId] = useState(3);
  const [cloneScatterRadius, setCloneScatterRadius] = useState(50);
  const [cloneMinDistance, setCloneMinDistance] = useState(10);
  const [cloneSeedBase, setCloneSeedBase] = useState("seed:editor");
  const [cloneRegionOverride, setCloneRegionOverride] = useState("");
  const [cloneResult, setCloneResult] = useState<any>(null);
  const [cloneWorking, setCloneWorking] = useState(false);

  // Scatter new
  const [scatterType, setScatterType] = useState("node");
  const [scatterArchetype, setScatterArchetype] = useState("node");
  const [scatterProtoId, setScatterProtoId] = useState("ore_iron_hematite");
  const [scatterVariantId, setScatterVariantId] = useState("");
  const [scatterCount, setScatterCount] = useState(20);
  const [scatterCenterX, setScatterCenterX] = useState(0);
  const [scatterCenterZ, setScatterCenterZ] = useState(0);
  const [scatterY, setScatterY] = useState(0);
  const [scatterRegionId, setScatterRegionId] = useState("");
  const [scatterTownTier, setScatterTownTier] = useState<string>("");
  const [scatterRadius, setScatterRadius] = useState(120);
  const [scatterMinDistance, setScatterMinDistance] = useState(10);
  const [scatterSeedBase, setScatterSeedBase] = useState("seed:editor");
  const [scatterResult, setScatterResult] = useState<any>(null);
  const [scatterWorking, setScatterWorking] = useState(false);

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

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const qs = new URLSearchParams();
      qs.set("shardId", shardId.trim() || "prime_shard");
      qs.set("limit", String(Math.max(1, Math.min(1000, Number(limit) || 200))));

      if (loadMode === "region") {
        qs.set("regionId", regionId.trim());
      } else if (loadMode === "radius") {
        qs.set("x", String(Number(queryX) || 0));
        qs.set("z", String(Number(queryZ) || 0));
        qs.set("radius", String(Math.max(0, Math.min(10000, Number(queryRadius) || 0))));
      }

      if (filterAuthority.trim()) qs.set("authority", filterAuthority.trim());
      if (filterType.trim()) qs.set("type", filterType.trim());
      if (filterArchetype.trim()) qs.set("archetype", filterArchetype.trim());
      if (filterProtoId.trim()) qs.set("protoId", filterProtoId.trim());
      if (filterSpawnId.trim()) qs.set("spawnId", filterSpawnId.trim());

      const url = `${ADMIN_API_BASE}/api/admin/spawn_points?${qs.toString()}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);

      const data: { ok: boolean; spawnPoints: AdminSpawnPoint[]; error?: string; total?: number } =
        await res.json();

      if (!data.ok) throw new Error(data.error || "Failed to load spawn points");

      const normalized = (data.spawnPoints ?? []).map((p) => ({
        ...p,
        authority: p.authority ?? getAuthority(p.spawnId),
      }));

      setSpawnPoints(normalized);

      // prune selections that no longer exist in this list
      const idsInList = new Set(normalized.map((p) => p.id));
      setSelectedIds((prev) => prev.filter((id) => idsInList.has(id)));

      if (selectedId != null && !idsInList.has(selectedId)) {
        setSelectedId(null);
      }
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
      regionId: loadMode === "region" ? regionId.trim() || null : null,
      townTier: null,
      authority: "manual",
    });
  };

  const updateField = <K extends keyof AdminSpawnPoint>(key: K, value: AdminSpawnPoint[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return Array.from(s.values());
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = spawnPoints.map((p) => p.id);
    const allSelected = visibleIds.every((id) => selectedSet.has(id));
    if (allSelected) {
      // clear only visible
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const clearSelection = () => setSelectedIds([]);

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

  const handleDeleteOne = async () => {
    if (!form || !form.id) return;
    if (!canEditSpawn(form.spawnId)) {
      setError("This spawn point is brain-owned (brain:*) and is read-only here.");
      return;
    }

    if (!window.confirm(`Delete spawn point #${form.id} (${form.spawnId})?`)) return;

    setSaving(true);
    setError(null);

    try {
      const url = `${ADMIN_API_BASE}/api/admin/spawn_points/${form.id}?shardId=${encodeURIComponent(
        shardId.trim() || "prime_shard"
      )}`;

      const res = await fetch(url, { method: "DELETE" });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || `Delete failed (HTTP ${res.status})`);
      }

      setSelectedId(null);
      setForm(null);
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Bulk delete ${selectedIds.length} spawn points? (brain:* will be skipped)`))
      return;

    setBulkWorking(true);
    setError(null);
    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/spawn_points/bulk_delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          ids: selectedIds,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || `Bulk delete failed (HTTP ${res.status})`);
      }

      clearSelection();
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBulkWorking(false);
    }
  };

  const bulkMove = async (dx: number, dy: number, dz: number) => {
    if (selectedIds.length === 0) return;

    setBulkWorking(true);
    setError(null);
    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/spawn_points/bulk_move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          ids: selectedIds,
          dx,
          dy,
          dz,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || `Bulk move failed (HTTP ${res.status})`);
      }

      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBulkWorking(false);
    }
  };

  const bulkNudge = async (dx: number, dz: number) => {
    await bulkMove(dx, 0, dz);
  };


  const parseWhereami = (txt: string): { x: number; y: number; z: number } | null => {
    // Example: "pos=(22.34, 0.00, 137.27)"
    const m = String(txt ?? "").match(/pos=\(\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*\)/i);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const z = Number(m[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x, y, z };
  };

  const applyWhereamiToScatter = () => {
    const p = parseWhereami(whereamiPaste);
    if (!p) {
      setError("Could not parse whereami. Paste a line containing: pos=(x, y, z)");
      return;
    }
    setScatterCenterX(p.x);
    setScatterCenterZ(p.z);
    setScatterY(p.y);
    if (loadMode === "region" && regionId.trim()) {
      setScatterRegionId(regionId.trim());
    }
  };

  const cloneSelected = async () => {
    if (selectedIds.length === 0) return;

    setCloneWorking(true);
    setError(null);
    setCloneResult(null);

    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/spawn_points/clone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          ids: selectedIds,
          countPerId: Number(cloneCountPerId) || 1,
          scatterRadius: Number(cloneScatterRadius) || 0,
          minDistance: Number(cloneMinDistance) || 0,
          seedBase: cloneSeedBase.trim() || "seed:editor",
          regionId: cloneRegionOverride.trim() ? cloneRegionOverride.trim() : null,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || `Clone failed (HTTP ${res.status})`);
      }

      setCloneResult(payload);
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setCloneWorking(false);
    }
  };

  const scatterNew = async () => {
    setScatterWorking(true);
    setError(null);
    setScatterResult(null);

    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/spawn_points/scatter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          type: scatterType.trim(),
          archetype: scatterArchetype.trim(),
          protoId: scatterProtoId.trim() || null,
          variantId: scatterVariantId.trim() || null,
          count: Number(scatterCount) || 1,
          centerX: Number(scatterCenterX) || 0,
          centerZ: Number(scatterCenterZ) || 0,
          y: Number(scatterY) || 0,
          regionId: scatterRegionId.trim() || null,
          townTier: scatterTownTier.trim() ? Number(scatterTownTier) : null,
          scatterRadius: Number(scatterRadius) || 0,
          minDistance: Number(scatterMinDistance) || 0,
          seedBase: scatterSeedBase.trim() || "seed:editor",
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || `Scatter failed (HTTP ${res.status})`);
      }

      setScatterResult(payload);
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setScatterWorking(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>Spawn Points Editor (v1)</h1>

      {error && <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>}

      {/* Load + filter controls */}
      <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Shard</span>
            <input style={{ width: 180 }} value={shardId} onChange={(e) => setShardId(e.target.value)} />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Load Mode</span>
            <select value={loadMode} onChange={(e) => setLoadMode(e.target.value as LoadMode)}>
              <option value="region">Region</option>
              <option value="radius">Radius</option>
              <option value="recent">Recent</option>
            </select>
          </label>

          {loadMode === "region" && (
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ opacity: 0.8 }}>Region</span>
              <input style={{ width: 240 }} value={regionId} onChange={(e) => setRegionId(e.target.value)} />
            </label>
          )}

          {loadMode === "radius" && (
            <>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>X</span>
                <input type="number" style={{ width: 110 }} value={queryX} onChange={(e) => setQueryX(Number(e.target.value) || 0)} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Z</span>
                <input type="number" style={{ width: 110 }} value={queryZ} onChange={(e) => setQueryZ(Number(e.target.value) || 0)} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Radius</span>
                <input type="number" style={{ width: 110 }} value={queryRadius} onChange={(e) => setQueryRadius(Number(e.target.value) || 0)} />
              </label>
            </>
          )}

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Authority</span>
            <select value={filterAuthority} onChange={(e) => setFilterAuthority(e.target.value)}>
              <option value="">(any)</option>
              <option value="anchor">anchor</option>
              <option value="seed">seed</option>
              <option value="manual">manual</option>
              <option value="brain">brain</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Type</span>
            <input style={{ width: 140 }} value={filterType} onChange={(e) => setFilterType(e.target.value)} placeholder="npc / node / poi" />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Archetype</span>
            <input style={{ width: 140 }} value={filterArchetype} onChange={(e) => setFilterArchetype(e.target.value)} placeholder="npc / resource / ..." />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>protoId contains</span>
            <input style={{ width: 180 }} value={filterProtoId} onChange={(e) => setFilterProtoId(e.target.value)} placeholder="ore / town_rat / ..." />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>spawnId contains</span>
            <input style={{ width: 180 }} value={filterSpawnId} onChange={(e) => setFilterSpawnId(e.target.value)} placeholder="seed:camp / anchor:..." />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Limit</span>
            <input type="number" style={{ width: 90 }} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 0)} />
          </label>

          <button onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Load"}
          </button>

          <button onClick={startNew} disabled={saving}>
            New
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: list + mother brain panels */}
        <div style={{ minWidth: 380 }}>
          {/* Mother Brain panel (kept) */}
          <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <h2 style={{ margin: "0 0 8px 0" }}>Mother Brain</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Bounds</span>
                <input value={mbBounds} onChange={(e) => setMbBounds(e.target.value)} placeholder="-1..1,-1..1" />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Cell Size</span>
                <input type="number" value={mbCellSize} onChange={(e) => setMbCellSize(Number(e.target.value) || 0)} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Theme (optional)</span>
                <input value={mbTheme} onChange={(e) => setMbTheme(e.target.value)} placeholder="(any)" />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Epoch (optional)</span>
                <input value={mbEpoch} onChange={(e) => setMbEpoch(e.target.value)} placeholder="(any)" />
              </label>
              <label style={{ display: "grid", gap: 4, gridColumn: "1 / span 2" }}>
                <span style={{ opacity: 0.8 }}>List Limit</span>
                <input type="number" value={mbLimit} onChange={(e) => setMbLimit(Number(e.target.value) || 0)} />
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
                      box_x={mbStatus.box.minX}..{mbStatus.box.maxX} box_z={mbStatus.box.minZ}..{mbStatus.box.maxZ}
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
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: "4px 6px" }}>
                              spawnId
                            </th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: "4px 6px" }}>
                              type
                            </th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: "4px 6px" }}>
                              proto
                            </th>
                            <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: "4px 6px" }}>
                              region
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {mbStatus.list.map((r) => (
                            <tr key={r.spawnId}>
                              <td style={{ borderBottom: "1px solid #222", padding: "4px 6px", fontFamily: "monospace" }}>
                                {r.spawnId}
                              </td>
                              <td style={{ borderBottom: "1px solid #222", padding: "4px 6px" }}>{r.type}</td>
                              <td style={{ borderBottom: "1px solid #222", padding: "4px 6px" }}>{r.protoId ?? ""}</td>
                              <td style={{ borderBottom: "1px solid #222", padding: "4px 6px" }}>{r.regionId ?? ""}</td>
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
                  <input type="number" value={waveEpoch} onChange={(e) => setWaveEpoch(Number(e.target.value) || 0)} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Count</span>
                  <input type="number" value={waveCount} onChange={(e) => setWaveCount(Number(e.target.value) || 0)} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Seed</span>
                  <input value={waveSeed} onChange={(e) => setWaveSeed(e.target.value)} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, gridColumn: "1 / span 2" }}>
                  <input type="checkbox" checked={waveAppend} onChange={(e) => setWaveAppend(e.target.checked)} />
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
                <pre style={{ marginTop: 10, background: "#111", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                  {JSON.stringify(waveResult, null, 2)}
                </pre>
              )}
            </div>
          </div>

          {/* Bulk ops */}
          <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong>Spawn Points in DB</strong>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.85 }}>{selectedIds.length} selected</span>
                <button onClick={toggleSelectAllVisible} disabled={spawnPoints.length === 0}>
                  Toggle all (visible)
                </button>
                <button onClick={clearSelection} disabled={selectedIds.length === 0}>
                  Clear selection
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>dx</span>
                  <input type="number" style={{ width: 90 }} value={bulkDx} onChange={(e) => setBulkDx(Number(e.target.value) || 0)} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>dy</span>
                  <input type="number" style={{ width: 90 }} value={bulkDy} onChange={(e) => setBulkDy(Number(e.target.value) || 0)} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>dz</span>
                  <input type="number" style={{ width: 90 }} value={bulkDz} onChange={(e) => setBulkDz(Number(e.target.value) || 0)} />
                </label>

                <button
                  disabled={bulkWorking || selectedIds.length === 0}
                  onClick={() => void bulkMove(bulkDx, bulkDy, bulkDz)}
                >
                  {bulkWorking ? "Working..." : "Bulk Move"}
                </button>

                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkDelete()}>
                  {bulkWorking ? "Working..." : "Bulk Delete"}
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, opacity: 0.8, alignSelf: "center" }}>Quick nudge (dx,dz):</span>
                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkNudge(-1, 0)}>
                  -1,0
                </button>
                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkNudge(1, 0)}>
                  +1,0
                </button>
                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkNudge(0, -1)}>
                  0,-1
                </button>
                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkNudge(0, 1)}>
                  0,+1
                </button>
                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkNudge(-5, 0)}>
                  -5,0
                </button>
                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkNudge(5, 0)}>
                  +5,0
                </button>
                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkNudge(0, -5)}>
                  0,-5
                </button>
                <button disabled={bulkWorking || selectedIds.length === 0} onClick={() => void bulkNudge(0, 5)}>
                  0,+5
                </button>
              </div>

              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Note: brain:* rows will be <b>skipped</b> by bulk delete/move even if selected.
              </div>
            </div>
          </div>

          {/* Clone / Scatter (System 3 MVP) */}
          <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong>Clone / Scatter (Editor Paint Tools)</strong>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Writes new spawn_points rows (seed:editor...). Brain-owned rows are skipped.</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Clone selected */}
              <div style={{ border: "1px solid #222", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Clone Selected</strong>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>{selectedIds.length} selected</span>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Copies each</span>
                    <input type="number" style={{ width: 100 }} value={cloneCountPerId} onChange={(e) => setCloneCountPerId(Number(e.target.value) || 0)} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Scatter radius</span>
                    <input type="number" style={{ width: 120 }} value={cloneScatterRadius} onChange={(e) => setCloneScatterRadius(Number(e.target.value) || 0)} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Min distance</span>
                    <input type="number" style={{ width: 120 }} value={cloneMinDistance} onChange={(e) => setCloneMinDistance(Number(e.target.value) || 0)} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Seed base</span>
                    <input style={{ width: 160 }} value={cloneSeedBase} onChange={(e) => setCloneSeedBase(e.target.value)} placeholder="seed:editor" />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Region override</span>
                    <input style={{ width: 180 }} value={cloneRegionOverride} onChange={(e) => setCloneRegionOverride(e.target.value)} placeholder="(optional)" />
                  </label>

                  <button disabled={cloneWorking || selectedIds.length === 0} onClick={() => void cloneSelected()}>
                    {cloneWorking ? "Working..." : "Clone"}
                  </button>
                </div>

                {cloneResult && (
                  <pre style={{ marginTop: 10, background: "#111", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                    {JSON.stringify(cloneResult, null, 2)}
                  </pre>
                )}
              </div>

              {/* Scatter new */}
              <div style={{ border: "1px solid #222", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Scatter New</strong>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>Drops a new batch around a center point</span>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Type</span>
                    <input style={{ width: 120 }} value={scatterType} onChange={(e) => setScatterType(e.target.value)} placeholder="node" />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Archetype</span>
                    <input style={{ width: 120 }} value={scatterArchetype} onChange={(e) => setScatterArchetype(e.target.value)} placeholder="node" />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>ProtoId</span>
                    <input style={{ width: 180 }} value={scatterProtoId} onChange={(e) => setScatterProtoId(e.target.value)} placeholder="ore_iron_hematite" />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>VariantId</span>
                    <input style={{ width: 140 }} value={scatterVariantId} onChange={(e) => setScatterVariantId(e.target.value)} placeholder="(optional)" />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Count</span>
                    <input type="number" style={{ width: 100 }} value={scatterCount} onChange={(e) => setScatterCount(Number(e.target.value) || 0)} />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Center X</span>
                    <input type="number" style={{ width: 120 }} value={scatterCenterX} onChange={(e) => setScatterCenterX(Number(e.target.value) || 0)} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Center Z</span>
                    <input type="number" style={{ width: 120 }} value={scatterCenterZ} onChange={(e) => setScatterCenterZ(Number(e.target.value) || 0)} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Y</span>
                    <input type="number" style={{ width: 100 }} value={scatterY} onChange={(e) => setScatterY(Number(e.target.value) || 0)} />
                  </label>

                  <button
                    onClick={() => {
                      if (loadMode === "radius") {
                        setScatterCenterX(Number(queryX) || 0);
                        setScatterCenterZ(Number(queryZ) || 0);
                      }
                      if (loadMode === "region") {
                        setScatterRegionId(regionId.trim());
                      }
                    }}
                  >
                    Use current query
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
                  <label style={{ display: "grid", gap: 4, flex: 1, minWidth: 260 }}>
                    <span style={{ opacity: 0.8 }}>whereami paste</span>
                    <input value={whereamiPaste} onChange={(e) => setWhereamiPaste(e.target.value)} placeholder='Paste: pos=(22.34, 0.00, 137.27)' />
                  </label>
                  <button onClick={applyWhereamiToScatter}>Apply</button>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>RegionId</span>
                    <input style={{ width: 220 }} value={scatterRegionId} onChange={(e) => setScatterRegionId(e.target.value)} placeholder="(optional)" />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Town tier</span>
                    <input style={{ width: 100 }} value={scatterTownTier} onChange={(e) => setScatterTownTier(e.target.value)} placeholder="(opt)" />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Scatter radius</span>
                    <input type="number" style={{ width: 120 }} value={scatterRadius} onChange={(e) => setScatterRadius(Number(e.target.value) || 0)} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Min distance</span>
                    <input type="number" style={{ width: 120 }} value={scatterMinDistance} onChange={(e) => setScatterMinDistance(Number(e.target.value) || 0)} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ opacity: 0.8 }}>Seed base</span>
                    <input style={{ width: 160 }} value={scatterSeedBase} onChange={(e) => setScatterSeedBase(e.target.value)} placeholder="seed:editor" />
                  </label>

                  <button disabled={scatterWorking} onClick={() => void scatterNew()}>
                    {scatterWorking ? "Working..." : "Scatter"}
                  </button>
                </div>

                {scatterResult && (
                  <pre style={{ marginTop: 10, background: "#111", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                    {JSON.stringify(scatterResult, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>

          {/* List */}
          <div style={{ maxHeight: 640, overflow: "auto", paddingRight: 6 }}>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {spawnPoints.map((sp) => {
                const auth = sp.authority ?? getAuthority(sp.spawnId);
                const selected = sp.id === selectedId;
                const checked = selectedSet.has(sp.id);

                return (
                  <li
                    key={sp.id}
                    style={{
                      padding: 6,
                      marginBottom: 4,
                      border: selected ? "2px solid #4caf50" : "1px solid #ccc",
                      borderRadius: 6,
                      cursor: "pointer",
                      opacity: auth === "brain" ? 0.75 : 1,
                      display: "grid",
                      gridTemplateColumns: "24px 1fr",
                      gap: 8,
                      alignItems: "start",
                    }}
                    onClick={() => setSelectedId(sp.id)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(sp.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 3 }}
                      title="select for bulk ops"
                    />

                    <div>
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
                    </div>
                  </li>
                );
              })}

              {spawnPoints.length === 0 && <li>No spawn points returned.</li>}
            </ul>
          </div>
        </div>

        {/* Right: spawn point form */}
        <div style={{ flex: 1 }}>
          {form ? (
            <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12 }}>
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
                    onChange={(e) => updateField("x", e.target.value === "" ? null : Number(e.target.value))}
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
                <label>
                  Y:
                  <input
                    type="number"
                    style={{ width: 120, marginLeft: 6 }}
                    value={form.y ?? ""}
                    onChange={(e) => updateField("y", e.target.value === "" ? null : Number(e.target.value))}
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
                <label>
                  Z:
                  <input
                    type="number"
                    style={{ width: 120, marginLeft: 6 }}
                    value={form.z ?? ""}
                    onChange={(e) => updateField("z", e.target.value === "" ? null : Number(e.target.value))}
                    disabled={!canEditSpawn(form.spawnId)}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button onClick={handleSave} disabled={saving || !canEditSpawn(form.spawnId)}>
                  {saving ? "Saving..." : "Save Spawn Point"}
                </button>
                <button type="button" onClick={startNew} disabled={saving}>
                  Clear / New
                </button>
                <button
                  type="button"
                  onClick={handleDeleteOne}
                  disabled={saving || !form.id || !canEditSpawn(form.spawnId)}
                >
                  Delete
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
