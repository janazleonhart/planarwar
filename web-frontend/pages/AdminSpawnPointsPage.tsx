// web-frontend/pages/AdminSpawnPointsPage.tsx

import { useEffect, useMemo, useState } from "react";
import { getAdminCaps, getAuthToken } from "../lib/api";

// ----- UI state persistence (safe on SSR) -----
const SPAWN_UI_LS_KEY = 'adminSpawnPointsPage.ui.v1';

 type SpawnUiSaved = {
  shardId?: string;
  activeTab?: 'browse' | 'tools' | 'brain';
  toolsSubtab?: 'bulk' | 'paint' | 'baseline';
  loadMode?: 'region' | 'xy';
  regionId?: string;
  queryX?: number;
  queryZ?: number;
  queryRadius?: number;
  filterAuthority?: string;
  filterType?: string;
  filterArchetype?: string;
  filterProtoId?: string;
  filterSpawnId?: string;
  limit?: number;
  recommendedOrder?: boolean;
  quickSearch?: string;

  // Tools: town baseline
  baselineSeedBase?: string;
  baselineSpawnIdMode?: "seed" | "legacy";
  baselineBounds?: string;
  baselineCellSize?: number;
  baselineIncludeMailbox?: boolean;
  baselineIncludeRest?: boolean;
  baselineIncludeStations?: boolean;
  baselineRespectTierStations?: boolean;
  baselineIncludeGuards?: boolean;
  baselineGuardCount?: number;
  baselineIncludeDummies?: boolean;
  baselineDummyCount?: number;
  baselineTownTierOverride?: string;

  // Tools: snapshot/restore (spawn_points slices)
  snapshotBounds?: string;
  snapshotCellSize?: number;
  snapshotPad?: number;
  snapshotTypes?: string;
  snapshotSaveName?: string;

  restoreTargetShard?: string;
  restoreUpdateExisting?: boolean;
  restoreAllowBrainOwned?: boolean;

};

function safeLoadSpawnUiState(): SpawnUiSaved {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SPAWN_UI_LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

function safeSaveSpawnUiState(state: SpawnUiSaved) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SPAWN_UI_LS_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const STICKY_TOP_PX = 96;


type SpawnAuthority = "anchor" | "seed" | "brain" | "manual";
type LoadMode = "region" | "radius" | "recent";

type AdminTab = "browse" | "tools" | "brain";

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



// Town Baseline seeding (Placement Editor MVP)

type TownBaselinePlanItem = {
  spawn: AdminSpawnPoint;
  op: "insert" | "update" | "skip";
  existingId?: number | null;
};

type TownBaselinePlanResponse = {
  ok: boolean;
  shardId: string;
  bounds: string;
  cellSize: number;
  seedBase: string;
  spawnIdMode: "seed" | "legacy";
  includeStations: boolean;
  respectTownTierStations: boolean;
  townTierOverride: number | null;

  wouldInsert?: number;
  wouldUpdate?: number;
  wouldSkip?: number;
  skippedReadOnly?: number;

  plan?: TownBaselinePlanItem[];
  error?: string;
};

type SpawnSnapshotResponse = {
  kind: "spawn_points.snapshot";
  ok: boolean;
  error?: string;
  filename?: string;
  snapshot?: any;
};

type StoredSpawnSnapshotMeta = {
  id: string;
  name: string;
  savedAt: string;
  shardId: string;
  rows: number;
  bounds: any;
  cellSize: number;
  pad: number;
  types: string[];
  bytes: number;
};

type SpawnSnapshotsListResponse = {
  kind: "spawn_points.snapshots";
  ok: boolean;
  error?: string;
  snapshots?: StoredSpawnSnapshotMeta[];
};

type SpawnSnapshotsSaveResponse = {
  kind: "spawn_points.snapshots.save";
  ok: boolean;
  error?: string;
  snapshot?: StoredSpawnSnapshotMeta;
};

type SpawnSnapshotsGetResponse = {
  kind: "spawn_points.snapshots.get";
  ok: boolean;
  error?: string;
  doc?: { id: string; name: string; savedAt: string; snapshot: any };
};

type SpawnSnapshotsDeleteResponse = {
  kind: "spawn_points.snapshots.delete";
  ok: boolean;
  error?: string;
  id?: string;
};


type SpawnRestoreResponse = {
  kind: "spawn_points.restore";
  ok: boolean;
  error?: string;

  commit?: boolean;

  snapshotShard?: string;
  targetShard?: string;
  crossShard?: boolean;
  allowBrainOwned?: boolean;

  rows?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  skippedReadOnly?: number;

  // For confirm_required (updates to existing rows) and/or confirm_phrase_required (high-risk restore modes).
  expectedConfirmToken?: string;
  expectedConfirmPhrase?: string;

  // dry-run preview buckets for operations (insert/update/skip/duplicates/etc)
  opsPreview?: any;

  // legacy shape for older callers/tests
  wouldInsert?: number;
  wouldUpdate?: number;
  wouldSkip?: number;
  wouldReadOnly?: number;
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

  // audit/echo (present on confirm_required; may be present on plan/commit)
  shardId?: string;
  bounds?: string;
  cellSize?: number;

  expectedConfirmToken?: string;

  wouldInsert?: number;
  wouldDelete?: number;
  inserted?: number;
  deleted?: number;
  error?: string;
};


type MotherBrainWipeResponse = {
  ok: boolean;
  commit: boolean;

  // audit/echo (present on confirm_required; may be present on plan/commit)
  shardId?: string;
  bounds?: string;
  cellSize?: number;
  borderMargin?: number;

  expectedConfirmToken?: string;

  wouldDelete?: number;
  deleted?: number;
  // optional preview list (shape matches status list)
  list?: MotherBrainListRow[];
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
  const caps = getAdminCaps();
  if (!caps.canWrite) return false;
  return getAuthority(spawnId) !== "brain";
}

const AUTHORITY_SORT: Record<SpawnAuthority, number> = {
  anchor: 0,
  seed: 1,
  manual: 2,
  brain: 3,
};

const TYPE_SORT: Record<string, number> = {
  // High-level infrastructure first
  town: 0,
  outpost: 1,
  graveyard: 2,
  checkpoint: 3,
  poi: 4,

  // Town services + stations
  mailbox: 10,
  rest: 11,
  station: 12,

  // Actors + resources
  npc: 20,
  resource: 30,
  node: 30,
};


function normStr(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function compareSpawnPointsRecommended(a: AdminSpawnPoint, b: AdminSpawnPoint): number {
  const aAuth = (a.authority ?? getAuthority(a.spawnId)) as SpawnAuthority;
  const bAuth = (b.authority ?? getAuthority(b.spawnId)) as SpawnAuthority;

  // Keep brain-owned spawns last, anchors first, etc.
  const authCmp = (AUTHORITY_SORT[aAuth] ?? 99) - (AUTHORITY_SORT[bAuth] ?? 99);
  if (authCmp) return authCmp;

  // Recommended order: town infrastructure -> services/stations -> NPCs -> resources
  const aTypeKey = normStr(a.type);
  const bTypeKey = normStr(b.type);
  const typeCmp = (TYPE_SORT[aTypeKey] ?? 999) - (TYPE_SORT[bTypeKey] ?? 999);
  if (typeCmp) return typeCmp;

  // Within a type bucket, keep things grouped and predictable
  const archCmp = normStr(a.archetype).localeCompare(normStr(b.archetype));
  if (archCmp) return archCmp;

  const protoCmp = normStr(a.protoId).localeCompare(normStr(b.protoId));
  if (protoCmp) return protoCmp;

  const spawnCmp = normStr(a.spawnId).localeCompare(normStr(b.spawnId));
  if (spawnCmp) return spawnCmp;

  return (Number(a.id) || 0) - (Number(b.id) || 0);
}

function compareSpawnPointsDefault(a: AdminSpawnPoint, b: AdminSpawnPoint): number {
  // Preserve a mostly "DB-ish" order when recommended sorting is off.
  const aId = Number(a.id) || 0;
  const bId = Number(b.id) || 0;
  if (aId != bId) return aId - bId;
  return normStr(a.spawnId).localeCompare(normStr(b.spawnId));
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


function SummaryPanel(props: { title: string; tone?: "neutral" | "danger" | "good"; rows: Array<[string, any]>; children?: any }) {
  const tone = props.tone ?? "neutral";
  const border = tone === "danger" ? "1px solid #b71c1c" : tone === "good" ? "1px solid #2e7d32" : "1px solid #555";
  const bg = tone === "danger" ? "#140a0a" : tone === "good" ? "#0b140b" : "#0b0b0b";
  const fg = "#eee";

  return (
    <div style={{ border, borderRadius: 8, padding: 10, background: bg, color: fg }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>{props.title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontFamily: "monospace", fontSize: 12 }}>
        {props.rows.map(([k, v]) => (
          <div key={k}>
            <span style={{ opacity: 0.85 }}>{k}</span>: <span style={{ opacity: 0.95 }}>{String(v ?? "")}</span>
          </div>
        ))}
      </div>
      {props.children ? <div style={{ marginTop: 8 }}>{props.children}</div> : null}
    </div>
  );
}

const authedFetch: typeof fetch = (input: any, init?: any) => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...(init ?? {}), headers });
};

export function AdminSpawnPointsPage() {
  const caps = getAdminCaps();
  const canWrite = caps.canWrite;
  const canRoot = caps.canRoot;

  const savedUi = useMemo(() => safeLoadSpawnUiState(), []);
  const [spawnPoints, setSpawnPoints] = useState<AdminSpawnPoint[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<AdminSpawnPoint | null>(null);

  const [shardId, setShardId] = useState(savedUi.shardId || "prime_shard");
  const [activeTab, setActiveTab] = useState<AdminTab>((savedUi.activeTab as AdminTab) || "browse");
  const [toolsSubtab, setToolsSubtab] = useState<"bulk" | "paint" | "baseline" | "snapshot">((savedUi.toolsSubtab as any) || "bulk");

  // Load controls
  const [loadMode, setLoadMode] = useState<LoadMode>((savedUi.loadMode as LoadMode) || "region");
  const [regionId, setRegionId] = useState(savedUi.regionId || "prime_shard:0,0");
  const [queryX, setQueryX] = useState(savedUi.queryX ?? 0);
  const [queryZ, setQueryZ] = useState(savedUi.queryZ ?? 0);
  const [queryRadius, setQueryRadius] = useState(savedUi.queryRadius ?? 500);

  // Filters
  const [filterAuthority, setFilterAuthority] = useState<string>(savedUi.filterAuthority || "");
  const [filterType, setFilterType] = useState(savedUi.filterType || "");
  const [filterArchetype, setFilterArchetype] = useState(savedUi.filterArchetype || "");
  const [filterProtoId, setFilterProtoId] = useState(savedUi.filterProtoId || "");
  const [filterSpawnId, setFilterSpawnId] = useState(savedUi.filterSpawnId || "");
  const [quickSearch, setQuickSearch] = useState(savedUi.quickSearch || "");
  const [limit, setLimit] = useState(savedUi.limit ?? 200);
  const [recommendedOrder, setRecommendedOrder] = useState(savedUi.recommendedOrder ?? true);

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
  
  // Town Baseline (System 4 MVP)
  const [baselineSeedBase, setBaselineSeedBase] = useState(savedUi.baselineSeedBase || "seed:town_baseline");
  const [baselineSpawnIdMode, setBaselineSpawnIdMode] = useState<"seed" | "legacy">((savedUi.baselineSpawnIdMode as any) || "seed");
  const [baselineBounds, setBaselineBounds] = useState(savedUi.baselineBounds || "");
  const [baselineCellSize, setBaselineCellSize] = useState(savedUi.baselineCellSize ?? 64);
  const [baselineIncludeMailbox, setBaselineIncludeMailbox] = useState(savedUi.baselineIncludeMailbox ?? true);
  const [baselineIncludeRest, setBaselineIncludeRest] = useState(savedUi.baselineIncludeRest ?? true);
  const [baselineIncludeStations, setBaselineIncludeStations] = useState(savedUi.baselineIncludeStations ?? false);
  const [baselineRespectTierStations, setBaselineRespectTierStations] = useState(savedUi.baselineRespectTierStations ?? true);
  const [baselineIncludeGuards, setBaselineIncludeGuards] = useState(savedUi.baselineIncludeGuards ?? true);
  const [baselineGuardCount, setBaselineGuardCount] = useState(savedUi.baselineGuardCount ?? 2);
  const [baselineIncludeDummies, setBaselineIncludeDummies] = useState(savedUi.baselineIncludeDummies ?? true);
  const [baselineDummyCount, setBaselineDummyCount] = useState(savedUi.baselineDummyCount ?? 1);
  const [baselineTownTierOverride, setBaselineTownTierOverride] = useState(savedUi.baselineTownTierOverride || "");
  const [baselineWorking, setBaselineWorking] = useState(false);
  const [baselineResult, setBaselineResult] = useState<TownBaselinePlanResponse | null>(null);
  const [baselineLastCommit, setBaselineLastCommit] = useState(false);

  // Snapshot / Restore (spawn_points slices)
  const [snapshotBounds, setSnapshotBounds] = useState(savedUi.snapshotBounds || "");
  const [snapshotCellSize, setSnapshotCellSize] = useState(savedUi.snapshotCellSize ?? 64);
  const [snapshotPad, setSnapshotPad] = useState(savedUi.snapshotPad ?? 0);
  const [snapshotTypes, setSnapshotTypes] = useState(
    savedUi.snapshotTypes || "town,outpost,checkpoint,graveyard,npc,node,station,mailbox,rest,vendor,guard,dummy"
  );
  const [snapshotWorking, setSnapshotWorking] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<SpawnSnapshotResponse | null>(null);


const [snapshotSaveName, setSnapshotSaveName] = useState(savedUi.snapshotSaveName || "");
const [savedSnapshots, setSavedSnapshots] = useState<StoredSpawnSnapshotMeta[]>([]);
const [savedSnapshotsLoading, setSavedSnapshotsLoading] = useState(false);
const [snapshotSaveWorking, setSnapshotSaveWorking] = useState(false);
const [snapshotLoadWorking, setSnapshotLoadWorking] = useState(false);
const [snapshotDeleteWorking, setSnapshotDeleteWorking] = useState<string | null>(null);
const [selectedSavedSnapshotId, setSelectedSavedSnapshotId] = useState<string>("");


  const [restoreJsonText, setRestoreJsonText] = useState("");
  const [restoreTargetShard, setRestoreTargetShard] = useState(savedUi.restoreTargetShard || "");
  const [restoreUpdateExisting, setRestoreUpdateExisting] = useState(savedUi.restoreUpdateExisting ?? true);
  const [restoreAllowBrainOwned, setRestoreAllowBrainOwned] = useState(savedUi.restoreAllowBrainOwned ?? false);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoreWorking, setRestoreWorking] = useState(false);
  const [restoreResult, setRestoreResult] = useState<SpawnRestoreResponse | null>(null);
  const [restoreConfirmExpected, setRestoreConfirmExpected] = useState<string | null>(null);
  const [restoreConfirmRequired, setRestoreConfirmRequired] = useState(false);

  const [restoreConfirmPhrase, setRestoreConfirmPhrase] = useState("");
  const [restoreConfirmPhraseExpected, setRestoreConfirmPhraseExpected] = useState<string | null>(null);
  const [restoreConfirmPhraseRequired, setRestoreConfirmPhraseRequired] = useState(false);

  const restoreSnapshotShard = useMemo(() => {
    try {
      const obj = JSON.parse(restoreJsonText || "{}");
      const shard =
        (obj && typeof obj === "object" && (obj as any).shardId) ||
        (obj && typeof obj === "object" && (obj as any).snapshot?.shardId) ||
        "";
      return String(shard || "").trim();
    } catch {
      return "";
    }
  }, [restoreJsonText]);

  const effectiveRestoreTargetShard = (restoreTargetShard.trim() || shardId || "").trim() || "prime_shard";
  const restoreCrossShard =
    !!restoreSnapshotShard && effectiveRestoreTargetShard !== restoreSnapshotShard;

  // Phrase confirm is required for especially risky restore modes (cross-shard, brain-owned).
  const restoreNeedsPhrase =
    restoreAllowBrainOwned || restoreCrossShard || restoreConfirmPhraseRequired;

  const restoreExpectedPhrase =
    restoreConfirmPhraseExpected || (restoreNeedsPhrase ? "RESTORE" : "");



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
  const [waveConfirmExpected, setWaveConfirmExpected] = useState<string | null>(null);
  const [waveConfirmInput, setWaveConfirmInput] = useState("");
  const [waveConfirmRequired, setWaveConfirmRequired] = useState(false);


  // Mother Brain (wipe)
  const [wipeTheme, setWipeTheme] = useState<string>("");
  const [wipeEpoch, setWipeEpoch] = useState<string>("");
  const [wipeBorderMargin, setWipeBorderMargin] = useState(0);
  const [wipeWithList, setWipeWithList] = useState(true);
  const [wipeLimit, setWipeLimit] = useState(25);
  const [wipeLoading, setWipeLoading] = useState(false);
  const [wipeResult, setWipeResult] = useState<MotherBrainWipeResponse | null>(null);
  const [wipeConfirmExpected, setWipeConfirmExpected] = useState<string | null>(null);
  const [wipeConfirmInput, setWipeConfirmInput] = useState("");
  const [wipeConfirmRequired, setWipeConfirmRequired] = useState(false);
  const [wipeUnlockInput, setWipeUnlockInput] = useState("");


  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const visibleSpawnPoints = useMemo(() => {
    const ordered = !recommendedOrder ? [...spawnPoints] : (() => {
      const arr = [...spawnPoints];
      arr.sort(compareSpawnPointsRecommended);
      return arr;
    })();

    const q = normStr(quickSearch);
    if (!q) return ordered;

    return ordered.filter((p) => {
      const hay = [
        p.type,
        p.archetype,
        p.spawnId,
        p.protoId ?? "",
        p.variantId ?? "",
        p.regionId ?? "",
      ].join(" ");
      return normStr(hay).includes(q);
    });
  }, [spawnPoints, recommendedOrder, quickSearch]);


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

      const url = `/api/admin/spawn_points?${qs.toString()}`;

      const res = await authedFetch(url);
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

      const url = `/api/admin/spawn_points/mother_brain/status?${qs.toString()}`;
      const res = await authedFetch(url);
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

  const runMotherBrainWave = async (commit: boolean, confirmToken?: string) => {
    setWaveLoading(true);
    setError(null);
    try {
      const url = `/api/admin/spawn_points/mother_brain/wave`;
      const res = await authedFetch(url, {
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
          confirm: confirmToken?.trim() ? confirmToken.trim() : null,
        }),
      });

      let data: MotherBrainWaveResponse | null = null;
      try {
        data = (await res.json()) as MotherBrainWaveResponse;
      } catch {
        data = null;
      }

      // Special case: confirm-required flow (409) is not an error to the UI.
      if (res.status === 409 && data && (data as any).error === "confirm_required" && (data as any).expectedConfirmToken) {
        setWaveConfirmExpected((data as any).expectedConfirmToken);
        setWaveConfirmInput("");
        setWaveConfirmRequired(true);
        setWaveResult(data);
        return;
      }

      if (!res.ok) throw new Error(`MotherBrain wave failed (HTTP ${res.status})`);
      if (!data) throw new Error("MotherBrain wave failed (no JSON)");
      if (!data.ok) throw new Error(data.error || "MotherBrain wave failed");

      // Success: clear confirm state.
      setWaveConfirmRequired(false);
      setWaveConfirmExpected((data as any).expectedConfirmToken ? String((data as any).expectedConfirmToken) : null);
      setWaveConfirmInput("");
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


  const runMotherBrainWipe = async (commit: boolean, confirmToken?: string) => {
    setWipeLoading(true);
    setError(null);
    try {
      const url = `/api/admin/spawn_points/mother_brain/wipe`;

      const theme = wipeTheme.trim();
      const epochRaw = wipeEpoch.trim();
      const epoch = epochRaw ? Number(epochRaw) : null;

      const res = await authedFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          bounds: mbBounds.trim() || "-1..1,-1..1",
          cellSize: Number(mbCellSize) || 64,
          borderMargin: Number(wipeBorderMargin) || 0,
          theme: theme ? theme : null,
          epoch: epochRaw ? (Number.isFinite(epoch) ? epoch : null) : null,
          list: !!wipeWithList,
          limit: Math.max(1, Math.min(200, Number(wipeLimit) || 25)),
          commit: !!commit,
          confirm: confirmToken?.trim() ? confirmToken.trim() : null,
        }),
      });

      let data: MotherBrainWipeResponse | null = null;
      try {
        data = (await res.json()) as MotherBrainWipeResponse;
      } catch {
        data = null;
      }

      // confirm-required flow (409)
      if (res.status === 409 && data && (data as any).error === "confirm_required" && (data as any).expectedConfirmToken) {
        setWipeConfirmExpected((data as any).expectedConfirmToken);
        setWipeConfirmInput("");
        setWipeUnlockInput("");
        setWipeConfirmRequired(true);
        setWipeResult(data);
        return;
      }

      if (!res.ok) throw new Error(`MotherBrain wipe failed (HTTP ${res.status})`);
      if (!data) throw new Error("MotherBrain wipe failed (no JSON)");
      if (!data.ok) throw new Error(data.error || "MotherBrain wipe failed");

      // Success: clear confirm state.
      setWipeConfirmRequired(false);
      setWipeConfirmExpected((data as any).expectedConfirmToken ? String((data as any).expectedConfirmToken) : null);
      setWipeConfirmInput("");
      setWipeUnlockInput("");
      setWipeResult(data);

      // Refresh status + reload list so it feels immediate.
      await runMotherBrainStatus(false);
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setWipeLoading(false);
    }
  };

  // If wave/wipe parameters change, discard any stale confirm token.
  useEffect(() => {
    setWaveConfirmExpected(null);
    setWaveConfirmInput("");
    setWaveConfirmRequired(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mbBounds, mbCellSize, waveTheme, waveEpoch, waveCount, waveSeed, waveAppend]);

  useEffect(() => {
    setWipeConfirmExpected(null);
    setWipeConfirmInput("");
    setWipeUnlockInput("");
    setWipeConfirmRequired(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mbBounds, mbCellSize, wipeTheme, wipeEpoch, wipeBorderMargin]);

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

  // Persist the UI state so the editor opens where you left it.
  useEffect(() => {
    safeSaveSpawnUiState({
      shardId,
      activeTab: activeTab as any,
      toolsSubtab: toolsSubtab as any,
      loadMode: loadMode as any,
      regionId,
      queryX,
      queryZ,
      queryRadius,
      filterAuthority,
      filterType,
      filterArchetype,
      filterProtoId,
      filterSpawnId,
      quickSearch,
      limit,
      recommendedOrder,

      baselineSeedBase,
      baselineSpawnIdMode,
      baselineBounds,
      baselineCellSize,
      baselineIncludeMailbox,
      baselineIncludeRest,
      baselineIncludeStations,
      baselineRespectTierStations,
      baselineIncludeGuards,
      baselineGuardCount,
      baselineIncludeDummies,
      baselineDummyCount,
      baselineTownTierOverride,

      snapshotBounds,
      snapshotCellSize,
      snapshotPad,
      snapshotTypes,
      snapshotSaveName,
      restoreTargetShard,
      restoreUpdateExisting,
      restoreAllowBrainOwned,
    });
  }, [
    shardId,
    activeTab,
    toolsSubtab,
    loadMode,
    regionId,
    queryX,
    queryZ,
    queryRadius,
    filterAuthority,
    filterType,
    filterArchetype,
    filterProtoId,
    filterSpawnId,
    quickSearch,
    limit,
    recommendedOrder,

    baselineSeedBase,
    baselineSpawnIdMode,
    baselineBounds,
    baselineCellSize,
    baselineIncludeMailbox,
    baselineIncludeRest,
    baselineIncludeStations,
    baselineRespectTierStations,
    baselineIncludeGuards,
    baselineGuardCount,
    baselineIncludeDummies,
    baselineDummyCount,
    baselineTownTierOverride,

    snapshotBounds,
    snapshotCellSize,
    snapshotPad,
    snapshotTypes,
    snapshotSaveName,
    restoreTargetShard,
    restoreUpdateExisting,
    restoreAllowBrainOwned,
  ]);

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

  const selectedIdsForOps = useMemo(() => {
    if (!recommendedOrder) return selectedIds;
    const byId = new Map<number, AdminSpawnPoint>();
    for (const sp of spawnPoints) byId.set(sp.id, sp);
    return [...selectedIds].sort((a, b) => {
      const sa = byId.get(a);
      const sb = byId.get(b);
      if (!sa && !sb) return a - b;
      if (!sa) return 1;
      if (!sb) return -1;
      return compareSpawnPointsRecommended(sa, sb);
    });
  }, [recommendedOrder, selectedIds, spawnPoints]);

  const toggleSelectAllVisible = () => {
    const visibleIds = visibleSpawnPoints.map((p) => p.id);
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
      const res = await authedFetch(`/api/admin/spawn_points`, {
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
      const url = `/api/admin/spawn_points/${form.id}?shardId=${encodeURIComponent(
        shardId.trim() || "prime_shard"
      )}`;

      const res = await authedFetch(url, { method: "DELETE" });
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
    if (selectedIdsForOps.length === 0) return;
    if (!window.confirm(`Bulk delete ${selectedIds.length} spawn points? (brain:* will be skipped)`))
      return;

    setBulkWorking(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/spawn_points/bulk_delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          ids: selectedIdsForOps,
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
    if (selectedIdsForOps.length === 0) return;

    setBulkWorking(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/spawn_points/bulk_move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          ids: selectedIdsForOps,
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
    if (selectedIdsForOps.length === 0) return;

    setCloneWorking(true);
    setError(null);
    setCloneResult(null);

    try {
      const res = await authedFetch(`/api/admin/spawn_points/clone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shardId.trim() || "prime_shard",
          ids: selectedIdsForOps,
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
      const res = await authedFetch(`/api/admin/spawn_points/scatter`, {
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



  const runTownBaseline = async (commit: boolean) => {
    setBaselineWorking(true);
    setError(null);

    setBaselineLastCommit(commit);

    try {
      if (!form) throw new Error("Select a town/outpost spawn point in the list first.");
      if (form.x == null || form.z == null) throw new Error("Selected spawn is missing X/Z coords.");

      const shard = shardId.trim() || "prime_shard";
      const url = `/api/admin/spawn_points/town_baseline/${commit ? "apply" : "plan"}`;

      const boundsStr = baselineBounds.trim();
      const tierOverrideRaw = baselineTownTierOverride.trim();
      const tierOverride = tierOverrideRaw ? Number(tierOverrideRaw) : null;

      const res = await authedFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shard,
          townSpawn: { ...form, shardId: shard },
          bounds: boundsStr ? boundsStr : undefined,
          cellSize: Number(baselineCellSize) || 64,
          seedBase: baselineSeedBase,
          spawnIdMode: baselineSpawnIdMode,
          includeMailbox: !!baselineIncludeMailbox,
          includeRest: !!baselineIncludeRest,
          includeStations: !!baselineIncludeStations,
          respectTownTierStations: !!baselineRespectTierStations,
          includeGuards: !!baselineIncludeGuards,
          guardCount: Math.max(0, Number(baselineGuardCount) || 0),
          includeDummies: !!baselineIncludeDummies,
          dummyCount: Math.max(0, Number(baselineDummyCount) || 0),
          townTierOverride: tierOverride,
          commit: !!commit,
        }),
      });

      if (!res.ok) throw new Error(`Town baseline ${commit ? "apply" : "plan"} failed (HTTP ${res.status})`);
      const data: TownBaselinePlanResponse = await res.json();
      if (!data.ok) throw new Error(data.error || "Town baseline failed");

      setBaselineResult(data);

      // If server computed bounds (auto), reflect it for convenience.
      if (!boundsStr && data.bounds) setBaselineBounds(data.bounds);

      if (commit) {
        await load();
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBaselineWorking(false);
    }
  };

  const runSnapshot = async () => {
    setSnapshotWorking(true);
    setError(null);
    setSnapshotResult(null);

    try {
      const shard = shardId.trim() || "prime_shard";
      const boundsStr = snapshotBounds.trim();
      if (!boundsStr) throw new Error("Snapshot requires bounds (e.g. -1..1,-1..1).");

      const types = snapshotTypes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!types.length) throw new Error("Snapshot requires at least one type (comma list).");

      const res = await authedFetch(`/api/admin/spawn_points/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shardId: shard,
          bounds: boundsStr,
          cellSize: Math.max(1, Number(snapshotCellSize) || 512),
          pad: Math.max(0, Number(snapshotPad) || 0),
          types,
        }),
      });

      const data: SpawnSnapshotResponse = await res.json().catch(() => ({} as any));
      if (!res.ok || !data.ok) throw new Error(data.error || `Snapshot failed (HTTP ${res.status})`);

      setSnapshotResult(data);

      // Convenience: auto-download the snapshot when available
      if (data.filename && data.snapshot) {
        downloadJson(data.filename, data.snapshot);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSnapshotWorking(false);
    }
  };

const refreshSavedSnapshots = async () => {
  setSavedSnapshotsLoading(true);
  try {
    const res = await authedFetch(`/api/admin/spawn_points/snapshots`, { method: "GET" });
    const data: SpawnSnapshotsListResponse = await res.json().catch(() => ({} as any));
    if (!res.ok || !data.ok) throw new Error(data.error || `List snapshots failed (HTTP ${res.status})`);
    setSavedSnapshots(data.snapshots || []);
  } catch (e: any) {
    console.error(e);
    setError(e.message || String(e));
  } finally {
    setSavedSnapshotsLoading(false);
  }
};

const runSaveSnapshotToServer = async () => {
  setSnapshotSaveWorking(true);
  try {
    const name = snapshotSaveName.trim();
    if (!name) throw new Error("Snapshot name is required.");

    const boundsStr = snapshotBounds.trim();
    if (!boundsStr) throw new Error("Snapshot requires bounds (e.g. -1..1,-1..1).");

    const types = snapshotTypes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!types.length) throw new Error("Snapshot requires at least one type (comma list).");

    const res = await authedFetch(`/api/admin/spawn_points/snapshots/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        shardId: shardId || "prime_shard",
        bounds: boundsStr,
        cellSize: snapshotCellSize,
        pad: snapshotPad,
        types,
      }),
    });

    const data: SpawnSnapshotsSaveResponse = await res.json().catch(() => ({} as any));
    if (!res.ok || !data.ok) throw new Error(data.error || `Save snapshot failed (HTTP ${res.status})`);

    await refreshSavedSnapshots();
    if (data.snapshot?.id) setSelectedSavedSnapshotId(data.snapshot.id);
  } catch (e: any) {
    console.error(e);
    setError(e.message || String(e));
  } finally {
    setSnapshotSaveWorking(false);
  }
};

const runLoadSavedSnapshot = async (id: string) => {
  setSnapshotLoadWorking(true);
  try {
    if (!id) throw new Error("Pick a saved snapshot first.");

    const res = await authedFetch(`/api/admin/spawn_points/snapshots/${encodeURIComponent(id)}`, { method: "GET" });
    const data: SpawnSnapshotsGetResponse = await res.json().catch(() => ({} as any));
    if (!res.ok || !data.ok) throw new Error(data.error || `Load snapshot failed (HTTP ${res.status})`);

    const snap = (data.doc as any)?.snapshot;
    if (!snap) throw new Error("Saved snapshot is missing payload.");

    setRestoreJsonText(JSON.stringify(snap, null, 2));
    setRestoreConfirm("");
    setRestoreConfirmExpected(null);
    setRestoreConfirmRequired(false);
  } catch (e: any) {
    console.error(e);
    setError(e.message || String(e));
  } finally {
    setSnapshotLoadWorking(false);
  }
};

const runDeleteSavedSnapshot = async (id: string) => {
  setSnapshotDeleteWorking(id);
  try {
    if (!id) throw new Error("Pick a saved snapshot first.");

    const res = await authedFetch(`/api/admin/spawn_points/snapshots/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data: SpawnSnapshotsDeleteResponse = await res.json().catch(() => ({} as any));
    if (!res.ok || !data.ok) throw new Error(data.error || `Delete snapshot failed (HTTP ${res.status})`);

    if (selectedSavedSnapshotId === id) setSelectedSavedSnapshotId("");
    await refreshSavedSnapshots();
  } catch (e: any) {
    console.error(e);
    setError(e.message || String(e));
  } finally {
    setSnapshotDeleteWorking(null);
  }
};



  const onRestoreFilePicked = async (file: File | null) => {
    if (!file) return;
    try {
      const txt = await file.text();
      setRestoreJsonText(txt);
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const runRestore = async (commit: boolean) => {
    setRestoreWorking(true);
    setError(null);
    setRestoreResult(null);

    // reset gates; they'll be re-set if the server asks for them
    setRestoreConfirmExpected(null);
    setRestoreConfirmRequired(false);
    setRestoreConfirmPhraseExpected(null);
    setRestoreConfirmPhraseRequired(false);

    try {
      const targetShard = effectiveRestoreTargetShard;

      const raw = restoreJsonText.trim();
      if (!raw) throw new Error("Paste a snapshot JSON (or pick a file) first.");

      const snapshot = JSON.parse(raw);

      const res = await authedFetch(`/api/admin/spawn_points/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          snapshot,
          targetShard,
          updateExisting: !!restoreUpdateExisting,
          allowBrainOwned: !!restoreAllowBrainOwned,
          commit: !!commit,
          confirm: restoreConfirm.trim() || undefined,
          confirmPhrase: (restoreConfirmPhrase.trim() || undefined),
        }),
      });

      const data: SpawnRestoreResponse = await res.json().catch(() => ({} as any));

      // confirm gates: phrase first (more dangerous), then token
      if ((data as any).error === "confirm_phrase_required") {
        setRestoreResult(data);
        setRestoreConfirmPhraseExpected((data as any).expectedConfirmPhrase ?? "RESTORE");
        setRestoreConfirmPhraseRequired(true);
        // keep token info too if the server included it
        if ((data as any).expectedConfirmToken) {
          setRestoreConfirmExpected((data as any).expectedConfirmToken ?? null);
          setRestoreConfirmRequired(true);
        }
        return;
      }

      if ((data as any).error === "confirm_required") {
        setRestoreResult(data);
        setRestoreConfirmExpected((data as any).expectedConfirmToken ?? null);
        setRestoreConfirmRequired(true);
        // server may also include phrase expectation in some cases
        if ((data as any).expectedConfirmPhrase) {
          setRestoreConfirmPhraseExpected((data as any).expectedConfirmPhrase ?? "RESTORE");
          setRestoreConfirmPhraseRequired(true);
        }
        return;
      }

      if (!res.ok || !data.ok) throw new Error(data.error || `Restore failed (HTTP ${res.status})`);

      setRestoreResult(data);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setRestoreWorking(false);
    }
  };


  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filterAuthority.trim()) parts.push(`authority=${filterAuthority.trim()}`);
    if (filterType.trim()) parts.push(`type~${filterType.trim()}`);
    if (filterArchetype.trim()) parts.push(`arch~${filterArchetype.trim()}`);
    if (filterProtoId.trim()) parts.push(`proto~${filterProtoId.trim()}`);
    if (filterSpawnId.trim()) parts.push(`spawn~${filterSpawnId.trim()}`);
    if (quickSearch.trim()) parts.push(`q~${quickSearch.trim()}`);
    return parts.length ? parts.join(", ") : "none";
  }, [filterAuthority, filterType, filterArchetype, filterProtoId, filterSpawnId]);

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "white",
          zIndex: 50,
          paddingBottom: 12,
          marginBottom: 12,
          borderBottom: "1px solid #ddd",
        }}
      >
      <h1>Spawn Points Editor (v1)</h1>

      <div data-testid="spawnpoints-tabs" style={{ display: "flex", gap: 8, margin: "8px 0 12px 0" }}>
        <button
          onClick={() => setActiveTab("browse")}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: activeTab === "browse" ? "2px solid #4caf50" : "1px solid #ccc",
            background: "white",
            cursor: "pointer",
            fontWeight: activeTab === "browse" ? 700 : 500,
          }}
        >
          Browse + Edit ({visibleSpawnPoints.length})
        </button>
        <button
          onClick={() => setActiveTab("tools")}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: activeTab === "tools" ? "2px solid #4caf50" : "1px solid #ccc",
            background: "white",
            cursor: "pointer",
            fontWeight: activeTab === "tools" ? 700 : 500,
          }}
        >
          Batch Tools ({selectedSet.size})
        </button>
        <button
          onClick={() => setActiveTab("brain")}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: activeTab === "brain" ? "2px solid #4caf50" : "1px solid #ccc",
            background: "white",
            cursor: "pointer",
            fontWeight: activeTab === "brain" ? 700 : 500,
          }}
        >
          Mother Brain
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, opacity: 0.8, alignSelf: "center" }}>Tip: use tabs to de-clutter the page.</div>
      </div>

      {error && <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>}

      {/* Load + filter controls */}
      <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end" }}>
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
              <span style={{ opacity: 0.8 }}>Limit</span>
              <input type="number" style={{ width: 90 }} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 0)} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, whiteSpace: "nowrap" }} title="Sort visible spawn points in a recommended authoring order">
              <input type="checkbox" checked={recommendedOrder} onChange={(e) => setRecommendedOrder(e.target.checked)} />
              <span>Recommended order</span>
            </label>

            <button onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Load"}
            </button>

            <button onClick={startNew} disabled={saving}>
              New
            </button>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 12, opacity: 0.85 }}>
            <div>
              Loaded: {spawnPoints.length} • Matched: {visibleSpawnPoints.length} • Selected: {selectedSet.size}
            </div>

            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ opacity: 0.9 }}>Quick search</span>
              <input
                style={{ width: 260 }}
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                placeholder="type / archetype / proto / spawn / region"
              />
              {quickSearch.trim() ? (
                <button type="button" onClick={() => setQuickSearch("")}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <details>
            <summary style={{ cursor: "pointer", userSelect: "none", opacity: 0.9 }}>
              Filters ({filterSummary})
            </summary>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end", marginTop: 10 }}>
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

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    setFilterAuthority("");
                    setFilterType("");
                    setFilterArchetype("");
                    setFilterProtoId("");
                    setFilterSpawnId("");
                    setQuickSearch("");
                  }}
                >
                  Clear filters
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>

      </div>

      {activeTab === "brain" ? (
        <div style={{ marginTop: 12 }}>
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
                <button disabled={waveLoading || !canWrite} onClick={() => void runMotherBrainWave(false)}>
                  {waveLoading ? "Working..." : "Plan (dry-run)"}
                </button>
                <button
                  disabled={waveLoading || !canWrite}
                  onClick={() => {
                    const wouldDelete = Number((waveResult as any)?.wouldDelete ?? 0);
                    // If we already have a token from a prior plan, don't even try the commit without it.
                    if (!waveAppend && waveConfirmExpected && wouldDelete > 0) {
                      setWaveConfirmRequired(true);
                      setWaveConfirmInput("");
                      return;
                    }
                    void runMotherBrainWave(true);
                  }}
                >
                  {waveLoading ? "Working..." : "Commit"}
                </button>
              </div>

              {waveConfirmExpected && !waveConfirmRequired ? (
                <div style={{ marginTop: 10, border: "1px solid #555", borderRadius: 8, padding: 10, background: "#0b0b0b", color: "#eee" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Confirm token available</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                    Replace-mode commits that delete existing <code>brain:*</code> spawns may require this token. (The server will also re-issue it on commit.)
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", opacity: 0.95, flex: 1, minWidth: 260 }}>
                      {waveConfirmExpected}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          void navigator.clipboard?.writeText(String(waveConfirmExpected));
                        } catch {}
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWaveConfirmInput(String(waveConfirmExpected));
                        try {
                          void navigator.clipboard?.writeText(String(waveConfirmExpected));
                        } catch {}
                      }}
                    >
                      Copy + Fill
                    </button>
                  </div>
                </div>
              ) : null}

              {waveConfirmExpected && waveConfirmRequired && (
                <div style={{ marginTop: 10, border: "1px solid #b71c1c", borderRadius: 8, padding: 10, background: "#140a0a" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Confirm required</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                    This commit would delete existing <code>brain:*</code> spawns in-bounds. Re-run with the confirm token below.
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                    shard={shardId.trim() || "prime_shard"} bounds={mbBounds.trim() || "-1..1,-1..1"} cell={Number(mbCellSize) || 64} mode={waveAppend ? "append" : "replace"} wouldDelete={Number((waveResult as any)?.wouldDelete ?? 0)}
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", opacity: 0.95 }}>
                      {waveConfirmExpected}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <label style={{ display: "grid", gap: 4, flex: 1, minWidth: 260 }}>
                        <span style={{ opacity: 0.85, fontSize: 12 }}>Confirm token</span>
                        <input value={waveConfirmInput} onChange={(e) => setWaveConfirmInput(e.target.value)} placeholder={waveConfirmExpected} />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            void navigator.clipboard?.writeText(String(waveConfirmExpected));
                          } catch {}
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWaveConfirmInput(String(waveConfirmExpected));
                          try {
                            void navigator.clipboard?.writeText(String(waveConfirmExpected));
                          } catch {}
                        }}
                      >
                        Copy + Fill
                      </button>
                      <button
                        type="button"
                        disabled={waveLoading || waveConfirmInput.trim() !== waveConfirmExpected}
                        onClick={() => void runMotherBrainWave(true, waveConfirmInput)}
                        style={{ border: "1px solid #b71c1c" }}
                      >
                        Confirm + Commit
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {waveResult ? (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  <SummaryPanel
                    title="Wave summary"
                    tone={
                      Number((waveResult as any).wouldDelete ?? (waveResult as any).deleted ?? 0) > 0 && !waveAppend
                        ? "danger"
                        : "neutral"
                    }
                    rows={[
                      ["mode", waveAppend ? "append" : "replace"],
                      ["commit", (waveResult as any).commit ? "yes" : "no (dry-run)"],
                      ["wouldInsert", (waveResult as any).wouldInsert ?? 0],
                      ["wouldDelete", (waveResult as any).wouldDelete ?? 0],
                      ["inserted", (waveResult as any).inserted ?? 0],
                      ["deleted", (waveResult as any).deleted ?? 0],
                      ["theme", (waveResult as any).theme ?? waveTheme],
                      ["epoch", (waveResult as any).epoch ?? waveEpoch],
                    ]}
                  />

                                    {(waveResult as any).opsPreview ? (
                    <OpsPreviewPanel title="Wave diff preview" preview={(waveResult as any).opsPreview} downloadName="mother_brain_wave_preview.json" />
                  ) : null}

<details>
                    <summary style={{ cursor: "pointer", userSelect: "none", opacity: 0.9 }}>Raw response JSON</summary>
                    <pre style={{ marginTop: 10, background: "#111", color: "#eee", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                      {JSON.stringify(waveResult, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : null}
            </div>

            <div style={{ borderTop: "1px solid #333", marginTop: 12, paddingTop: 12 }}>
              <h3 style={{ margin: "0 0 8px 0" }}>Wipe (delete brain spawns)</h3>
              <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
                Deletes <code>brain:*</code> rows within <b>Bounds</b>. Optional filters: theme/epoch. Dry-run by default.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Theme (optional)</span>
                  <input value={wipeTheme} onChange={(e) => setWipeTheme(e.target.value)} placeholder="(any)" />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Epoch (optional)</span>
                  <input value={wipeEpoch} onChange={(e) => setWipeEpoch(e.target.value)} placeholder="(any)" />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>Border Margin</span>
                  <input type="number" value={wipeBorderMargin} onChange={(e) => setWipeBorderMargin(Number(e.target.value) || 0)} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ opacity: 0.8 }}>List Limit</span>
                  <input type="number" value={wipeLimit} onChange={(e) => setWipeLimit(Number(e.target.value) || 0)} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, gridColumn: "1 / span 2" }}>
                  <input type="checkbox" checked={wipeWithList} onChange={(e) => setWipeWithList(e.target.checked)} />
                  <span>Include preview list</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button disabled={wipeLoading || !canRoot} onClick={() => void runMotherBrainWipe(false)}>
                  {wipeLoading ? "Working..." : "Plan wipe (dry-run)"}
                </button>
                <button
                  disabled={wipeLoading || !canRoot}
                  onClick={() => {
                    const wouldDelete = Number((wipeResult as any)?.wouldDelete ?? 0);
                    if (wipeConfirmExpected && wouldDelete > 0) {
                      setWipeConfirmRequired(true);
                      setWipeConfirmInput("");
                      setWipeUnlockInput("");
                      return;
                    }
                    void runMotherBrainWipe(true);
                  }}
                  style={{ border: "1px solid #b71c1c" }}
                >
                  {wipeLoading ? "Working..." : "Commit wipe"}
                </button>
              </div>

              {wipeConfirmExpected && !wipeConfirmRequired ? (
                <div style={{ marginTop: 10, border: "1px solid #555", borderRadius: 8, padding: 10, background: "#0b0b0b", color: "#eee" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Confirm token available</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                    Commits that delete existing <code>brain:*</code> spawns may require this token. (The server will also re-issue it on commit.)
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", opacity: 0.95, flex: 1, minWidth: 260 }}>
                      {wipeConfirmExpected}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          void navigator.clipboard?.writeText(String(wipeConfirmExpected));
                        } catch {}
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWipeConfirmInput(String(wipeConfirmExpected));
                        try {
                          void navigator.clipboard?.writeText(String(wipeConfirmExpected));
                        } catch {}
                      }}
                    >
                      Copy + Fill
                    </button>
                  </div>
                </div>
              ) : null}

              {wipeConfirmExpected && wipeConfirmRequired && (
                <div style={{ marginTop: 10, border: "1px solid #b71c1c", borderRadius: 8, padding: 10, background: "#140a0a" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Confirm required</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                    This wipe would delete existing <code>brain:*</code> spawns in-bounds. Re-run with the confirm token below.
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                    shard={shardId.trim() || "prime_shard"} bounds={mbBounds.trim() || "-1..1,-1..1"} cell={Number(mbCellSize) || 64} borderMargin={Number(wipeBorderMargin) || 0} wouldDelete={Number((wipeResult as any)?.wouldDelete ?? 0)}
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", opacity: 0.95 }}>
                      {wipeConfirmExpected}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <label style={{ display: "grid", gap: 4, flex: 1, minWidth: 260 }}>
                        <span style={{ opacity: 0.85, fontSize: 12 }}>Type WIPE to unlock</span>
                        <input
                          value={wipeUnlockInput}
                          onChange={(e) => setWipeUnlockInput(e.target.value)}
                          placeholder="WIPE"
                        />
                      </label>

                      <label style={{ display: "grid", gap: 4, flex: 1, minWidth: 260 }}>
                        <span style={{ opacity: 0.85, fontSize: 12 }}>Confirm token</span>
                        <input
                          disabled={wipeUnlockInput.trim().toUpperCase() !== "WIPE"}
                          value={wipeConfirmInput}
                          onChange={(e) => setWipeConfirmInput(e.target.value)}
                          placeholder={wipeConfirmExpected}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            void navigator.clipboard?.writeText(String(wipeConfirmExpected));
                          } catch {}
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        disabled={wipeLoading || wipeUnlockInput.trim().toUpperCase() !== "WIPE" || wipeConfirmInput.trim() !== wipeConfirmExpected}
                        onClick={() => void runMotherBrainWipe(true, wipeConfirmInput)}
                        style={{ border: "1px solid #b71c1c" }}
                      >
                        Confirm + Commit
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {wipeResult ? (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  <SummaryPanel
                    title="Wipe summary"
                    tone={Number((wipeResult as any).wouldDelete ?? (wipeResult as any).deleted ?? 0) > 0 ? "danger" : "neutral"}
                    rows={[
                      ["commit", (wipeResult as any).commit ? "yes" : "no (dry-run)"],
                      ["theme", (wipeResult as any).theme ?? "(any)"],
                      ["epoch", (wipeResult as any).epoch ?? "(any)"],
                      ["borderMargin", (wipeResult as any).borderMargin ?? wipeBorderMargin],
                      ["wouldDelete", (wipeResult as any).wouldDelete ?? 0],
                      ["deleted", (wipeResult as any).deleted ?? 0],
                      ["listed", Array.isArray((wipeResult as any).list) ? (wipeResult as any).list.length : 0],
                    ]}
                  />

                                    {(wipeResult as any).opsPreview ? (
                    <OpsPreviewPanel title="Wipe diff preview" preview={(wipeResult as any).opsPreview} downloadName="mother_brain_wipe_preview.json" />
                  ) : null}

<details>
                    <summary style={{ cursor: "pointer", userSelect: "none", opacity: 0.9 }}>Raw response JSON</summary>
                    <pre style={{ marginTop: 10, background: "#111", color: "#eee", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                      {JSON.stringify(wipeResult, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : null}
            </div>


          </div>


        </div>
      ) : (
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Left: list + mother brain panels */}
        <div style={{ minWidth: 380 }}>
          {activeTab === "tools" ? (
            <>
              <div data-testid="tools-subtabs" style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => setToolsSubtab("bulk")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: toolsSubtab === "bulk" ? "2px solid #4caf50" : "1px solid #ccc",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: toolsSubtab === "bulk" ? 700 : 500,
                  }}
                >
                  Bulk Ops
                </button>
                <button
                  onClick={() => setToolsSubtab("paint")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: toolsSubtab === "paint" ? "2px solid #4caf50" : "1px solid #ccc",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: toolsSubtab === "paint" ? 700 : 500,
                  }}
                >
                  Clone / Scatter
                </button>
                <button
                  onClick={() => setToolsSubtab("baseline")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: toolsSubtab === "baseline" ? "2px solid #4caf50" : "1px solid #ccc",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: toolsSubtab === "baseline" ? 700 : 500,
                  }}
                >
                  Town Baseline
                </button>

                <button
                  onClick={() => setToolsSubtab("snapshot")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: toolsSubtab === "snapshot" ? "2px solid #4caf50" : "1px solid #ccc",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: toolsSubtab === "snapshot" ? 700 : 500,
                  }}
                >
                  Snapshot / Restore
                </button>
              </div>
          {toolsSubtab === "bulk" ? (
            <>
          {/* Bulk ops */}
          <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong>Spawn Points in DB</strong>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.85 }}>{selectedIds.length} selected</span>
                <button onClick={toggleSelectAllVisible} disabled={visibleSpawnPoints.length === 0}>
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
                  disabled={bulkWorking || !canWrite || selectedIds.length === 0}
                  onClick={() => void bulkMove(bulkDx, bulkDy, bulkDz)}
                >
                  {bulkWorking ? "Working..." : "Bulk Move"}
                </button>

                <button disabled={bulkWorking || !canRoot || selectedIds.length === 0} onClick={() => void bulkDelete()}>
                  {bulkWorking ? "Working..." : "Bulk Delete"}
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, opacity: 0.8, alignSelf: "center" }}>Quick nudge (dx,dz):</span>
                <button disabled={bulkWorking || !canWrite || selectedIds.length === 0} onClick={() => void bulkNudge(-1, 0)}>
                  -1,0
                </button>
                <button disabled={bulkWorking || !canWrite || selectedIds.length === 0} onClick={() => void bulkNudge(1, 0)}>
                  +1,0
                </button>
                <button disabled={bulkWorking || !canWrite || selectedIds.length === 0} onClick={() => void bulkNudge(0, -1)}>
                  0,-1
                </button>
                <button disabled={bulkWorking || !canWrite || selectedIds.length === 0} onClick={() => void bulkNudge(0, 1)}>
                  0,+1
                </button>
                <button disabled={bulkWorking || !canWrite || selectedIds.length === 0} onClick={() => void bulkNudge(-5, 0)}>
                  -5,0
                </button>
                <button disabled={bulkWorking || !canWrite || selectedIds.length === 0} onClick={() => void bulkNudge(5, 0)}>
                  +5,0
                </button>
                <button disabled={bulkWorking || !canWrite || selectedIds.length === 0} onClick={() => void bulkNudge(0, -5)}>
                  0,-5
                </button>
                <button disabled={bulkWorking || !canWrite || selectedIds.length === 0} onClick={() => void bulkNudge(0, 5)}>
                  0,+5
                </button>
              </div>

              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Note: brain:* rows will be <b>skipped</b> by bulk delete/move even if selected.
              </div>
            </div>
          </div>


            </>
          ) : null}

          {toolsSubtab === "paint" ? (
            <>
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

                  <button disabled={cloneWorking || !canWrite || selectedIds.length === 0} onClick={() => void cloneSelected()}>
                    {cloneWorking ? "Working..." : "Clone"}
                  </button>
                </div>

                {cloneResult && (
                  <pre style={{ marginTop: 10, background: "#111", color: "#eee", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
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
                  <button onClick={applyWhereamiToScatter} disabled={!canWrite}>Apply</button>
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

                  <button disabled={scatterWorking || !canWrite} onClick={() => void scatterNew()}>
                    {scatterWorking ? "Working..." : "Scatter"}
                  </button>
                </div>

                {scatterResult && (
                  <pre style={{ marginTop: 10, background: "#111", color: "#eee", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                    {JSON.stringify(scatterResult, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>


            </>
          ) : null}

          {toolsSubtab === "baseline" ? (
            <>
              <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong>Town Baseline Seeder</strong>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>Plan/apply mailboxes, rest, guards (and optional stations) around a selected town/outpost.</span>
                </div>

                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10, lineHeight: 1.4 }}>
                  Select a <b>town</b> or <b>outpost</b> spawn on the left, then plan/apply a deterministic baseline using <code>seed:</code> spawnIds.
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ opacity: 0.8 }}>Seed base</span>
                      <input style={{ width: 200 }} value={baselineSeedBase} onChange={(e) => setBaselineSeedBase(e.target.value)} placeholder="seed:town_baseline" />
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ opacity: 0.8 }}>SpawnId mode</span>
                      <select style={{ width: 140 }} value={baselineSpawnIdMode} onChange={(e) => setBaselineSpawnIdMode(e.target.value as any)}>
                        <option value="seed">seed (editable)</option>
                        <option value="legacy">legacy (spawnId fallback)</option>
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ opacity: 0.8 }}>Cell size</span>
                      <input type="number" style={{ width: 110 }} value={baselineCellSize} onChange={(e) => setBaselineCellSize(Number(e.target.value) || 0)} />
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ opacity: 0.8 }}>Bounds (cells)</span>
                      <input style={{ width: 160 }} value={baselineBounds} onChange={(e) => setBaselineBounds(e.target.value)} placeholder="auto" />
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ opacity: 0.8 }}>Tier override</span>
                      <input style={{ width: 110 }} value={baselineTownTierOverride} onChange={(e) => setBaselineTownTierOverride(e.target.value)} placeholder="(opt)" />
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={baselineIncludeMailbox} onChange={(e) => setBaselineIncludeMailbox(e.target.checked)} />
                      Mailbox
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={baselineIncludeRest} onChange={(e) => setBaselineIncludeRest(e.target.checked)} />
                      Rest
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={baselineIncludeGuards} onChange={(e) => setBaselineIncludeGuards(e.target.checked)} />
                      Guards
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ opacity: 0.8 }}>Guard count</span>
                      <input type="number" style={{ width: 110 }} value={baselineGuardCount} onChange={(e) => setBaselineGuardCount(Number(e.target.value) || 0)} />
                    </label>

                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={baselineIncludeDummies} onChange={(e) => setBaselineIncludeDummies(e.target.checked)} />
                      Dummies
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ opacity: 0.8 }}>Dummy count</span>
                      <input type="number" style={{ width: 110 }} value={baselineDummyCount} onChange={(e) => setBaselineDummyCount(Number(e.target.value) || 0)} />
                    </label>

                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={baselineIncludeStations} onChange={(e) => setBaselineIncludeStations(e.target.checked)} />
                      Stations
                    </label>

                    {baselineIncludeStations ? (
                      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={baselineRespectTierStations} onChange={(e) => setBaselineRespectTierStations(e.target.checked)} />
                        Respect tier stations
                      </label>
                    ) : null}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button disabled={baselineWorking || !canWrite} onClick={() => void runTownBaseline(false)}>
                      {baselineWorking ? "Working..." : "Plan (dry-run)"}
                    </button>
                    <button disabled={baselineWorking || !canWrite} onClick={() => void runTownBaseline(true)} style={{ border: "1px solid #b71c1c" }}>
                      {baselineWorking ? "Working..." : "Commit apply"}
                    </button>
                  </div>

                  {baselineResult ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      <SummaryPanel
                        title={`Town baseline ${baselineLastCommit ? "apply" : "plan"} summary`}
                        tone={baselineLastCommit ? "good" : "neutral"}
                        rows={[
                          ["bounds", baselineResult.bounds ?? baselineBounds ?? ""],
                          ["cellSize", baselineResult.cellSize ?? baselineCellSize],
                          ["seedBase", baselineResult.seedBase ?? baselineSeedBase],
                          ["spawnIdMode", baselineResult.spawnIdMode ?? baselineSpawnIdMode],
                          ["wouldInsert", baselineResult.wouldInsert ?? 0],
                          ["wouldUpdate", baselineResult.wouldUpdate ?? 0],
                          ["wouldSkip", baselineResult.wouldSkip ?? 0],
                          ["skippedReadOnly", baselineResult.skippedReadOnly ?? 0],
                        ]}
/>

                      {(baselineResult as any).opsPreview ? (
                        <OpsPreviewPanel
                          title="Town baseline diff preview"
                          preview={(baselineResult as any).opsPreview}
                          downloadName="town_baseline_preview.json"
                        />
                      ) : null}


                      <details>
                        <summary style={{ cursor: "pointer", userSelect: "none", opacity: 0.9 }}>Raw response JSON</summary>
                        <pre style={{ marginTop: 10, background: "#111", color: "#eee", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                          {JSON.stringify(baselineResult, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {toolsSubtab === "snapshot" ? (
            <>
              <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong>Snapshot / Restore</strong>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>
                    Export/import a slice of <code>spawn_points</code> by bounds + type list. Great for moving towns between shards or sharing layouts.
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, opacity: 0.85 }}>Bounds (required)</span>
                    <input
                      value={snapshotBounds}
                      onChange={(e) => setSnapshotBounds(e.target.value)}
                      placeholder="-1..1,-1..1"
                      style={{ width: 180, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, opacity: 0.85 }}>Cell size</span>
                    <input
                      type="number"
                      value={snapshotCellSize}
                      onChange={(e) => setSnapshotCellSize(Number(e.target.value))}
                      style={{ width: 120, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, opacity: 0.85 }}>Pad</span>
                    <input
                      type="number"
                      value={snapshotPad}
                      onChange={(e) => setSnapshotPad(Number(e.target.value))}
                      style={{ width: 120, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 4, flex: 1, minWidth: 320 }}>
                    <span style={{ fontSize: 12, opacity: 0.85 }}>Types (comma list)</span>
                    <input
                      value={snapshotTypes}
                      onChange={(e) => setSnapshotTypes(e.target.value)}
                      placeholder="town,outpost,npc,node,station,..."
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
                    />
                  </label>

                  <button
                    onClick={runSnapshot}
                    disabled={snapshotWorking}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #ccc",
                      background: snapshotWorking ? "#f6f6f6" : "white",
                      cursor: snapshotWorking ? "not-allowed" : "pointer",
                      fontWeight: 700,
                    }}
                    title="Generates a snapshot JSON and auto-downloads it"
                  >
                    {snapshotWorking ? "Snapshotting..." : "Snapshot (download)"}
                  </button>
                </div>

                {snapshotResult ? (
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <SummaryPanel
                      title={"Snapshot summary"}
                      tone={snapshotResult.ok ? "good" : "danger"}
                      rows={[
                        ["filename", snapshotResult.filename ?? ""],
                        ["rows", (snapshotResult.snapshot as any)?.rows ?? ""],
                        ["types", (snapshotResult.snapshot as any)?.types?.join?.(", ") ?? ""],
                        ["bounds", (snapshotResult.snapshot as any)?.bounds ? JSON.stringify((snapshotResult.snapshot as any).bounds) : ""],
                      ]}
                    />
                    <details>
                      <summary style={{ cursor: "pointer", userSelect: "none", opacity: 0.9 }}>Raw snapshot JSON</summary>
                      <pre style={{ marginTop: 10, background: "#111", color: "#eee", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                        {JSON.stringify(snapshotResult.snapshot, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : null}

                
<div style={{ marginTop: 12, border: "1px solid #333", borderRadius: 8, padding: 10 }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
    <strong>Server snapshots</strong>
    <button
      onClick={refreshSavedSnapshots}
      disabled={savedSnapshotsLoading}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid #ccc",
        background: "white",
        cursor: savedSnapshotsLoading ? "not-allowed" : "pointer",
        fontWeight: 700,
        fontSize: 12,
      }}
      title="Refresh the list of snapshots saved on the web-backend host"
    >
      {savedSnapshotsLoading ? "Refreshing..." : "Refresh"}
    </button>
  </div>

  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
    <label style={{ display: "grid", gap: 4, minWidth: 260 }}>
      <span style={{ fontSize: 12, opacity: 0.85 }}>Name</span>
      <input
        value={snapshotSaveName}
        onChange={(e) => setSnapshotSaveName(e.target.value)}
        placeholder="e.g. newbie-town-v1"
        style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
      />
    </label>

    <button
      onClick={runSaveSnapshotToServer}
      disabled={snapshotSaveWorking}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #ccc",
        background: snapshotSaveWorking ? "#f6f6f6" : "white",
        cursor: snapshotSaveWorking ? "not-allowed" : "pointer",
        fontWeight: 700,
      }}
      title="Generates a snapshot from the bounds/types above and stores it on the server"
    >
      {snapshotSaveWorking ? "Saving..." : "Save to server"}
    </button>

    <label style={{ display: "grid", gap: 4, minWidth: 320, flex: 1 }}>
      <span style={{ fontSize: 12, opacity: 0.85 }}>Saved snapshots</span>
      <select
        value={selectedSavedSnapshotId}
        onChange={(e) => setSelectedSavedSnapshotId(e.target.value)}
        style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
      >
        <option value="">(none)</option>
        {savedSnapshots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} — {s.rows} rows — {new Date(s.savedAt).toLocaleString()}
          </option>
        ))}
      </select>
    </label>

    <button
      onClick={() => runLoadSavedSnapshot(selectedSavedSnapshotId)}
      disabled={snapshotLoadWorking}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #ccc",
        background: snapshotLoadWorking ? "#f6f6f6" : "white",
        cursor: snapshotLoadWorking ? "not-allowed" : "pointer",
        fontWeight: 700,
      }}
      title="Loads the selected saved snapshot into the restore box below"
    >
      {snapshotLoadWorking ? "Loading..." : "Load into restore"}
    </button>

    <button
      onClick={() => runDeleteSavedSnapshot(selectedSavedSnapshotId)}
      disabled={!selectedSavedSnapshotId || snapshotDeleteWorking === selectedSavedSnapshotId}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #ccc",
        background: "white",
        cursor: !selectedSavedSnapshotId || snapshotDeleteWorking === selectedSavedSnapshotId ? "not-allowed" : "pointer",
        fontWeight: 700,
      }}
      title="Deletes the selected saved snapshot from the server"
    >
      {snapshotDeleteWorking === selectedSavedSnapshotId ? "Deleting..." : "Delete"}
    </button>
  </div>

  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
    Stored under <code>data/spawn_snapshots</code> on the web-backend host (override with <code>PLANARWAR_SPAWN_SNAPSHOT_DIR</code>).
  </div>
</div>

<hr style={{ margin: "14px 0", opacity: 0.4 }} />

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.85 }}>Target shard</span>
                      <input
                        value={restoreTargetShard}
                        onChange={(e) => setRestoreTargetShard(e.target.value)}
                        placeholder={shardId || "prime_shard"}
                        style={{ width: 180, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
                      />
                    </label>

                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={restoreUpdateExisting}
                        onChange={(e) => setRestoreUpdateExisting(e.target.checked)}
                      />
                      Update existing spawn_ids
                    </label>

                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={restoreAllowBrainOwned}
                        onChange={(e) => setRestoreAllowBrainOwned(e.target.checked)}
                      />
                      Allow brain:* spawn_ids (danger)
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.85 }}>Confirm token (only when required)</span>
                      <input
                        value={restoreConfirm}
                        onChange={(e) => setRestoreConfirm(e.target.value)}
                        placeholder={restoreConfirmExpected || ""}
                        style={{ width: 220, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" }}
                      />
                    </label>

                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.85 }}>Confirm phrase (only when required)</span>
                      <input
                        value={restoreConfirmPhrase}
                        onChange={(e) => setRestoreConfirmPhrase(e.target.value)}
                        placeholder={restoreExpectedPhrase || ""}
                        style={{
                          width: 220,
                          padding: "6px 8px",
                          borderRadius: 6,
                          border: restoreNeedsPhrase ? "1px solid #c62828" : "1px solid #ccc",
                          background: restoreNeedsPhrase ? "#fff5f5" : "white",
                        }}
                      />
                    </label>

                    <input
                      type="file"
                      accept="application/json"
                      onChange={(e) => onRestoreFilePicked(e.target.files?.[0] ?? null)}
                      title="Load snapshot JSON from file"
                    />

                    <button
                      onClick={() => runRestore(false)}
                      disabled={restoreWorking}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #ccc",
                        background: "white",
                        cursor: restoreWorking ? "not-allowed" : "pointer",
                        fontWeight: 700,
                      }}
                      title="Dry run restore (no DB writes)"
                    >
                      {restoreWorking ? "Working..." : "Dry-run restore"}
                    </button>

                    <button
                      onClick={() => runRestore(true)}
                      disabled={
                        restoreWorking ||
                        !canWrite ||
                        (restoreNeedsPhrase && restoreConfirmPhrase.trim() !== (restoreExpectedPhrase || "")) ||
                        (restoreConfirmRequired && restoreConfirm.trim() !== (restoreConfirmExpected || ""))
                      }
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "2px solid #c62828",
                        background: "white",
                        cursor: restoreWorking ? "not-allowed" : "pointer",
                        fontWeight: 800,
                      }}
                      title="Commit restore (writes DB). If deletions are involved, a confirm token may be required."
                    >
                      Commit restore
                    </button>
                  </div>

                  {restoreNeedsPhrase ? (
                    <div style={{ padding: 10, borderRadius: 8, border: "1px solid #c62828", background: "#fff5f5" }}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>High-risk restore</div>
                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        This restore is flagged as risky because it {restoreCrossShard ? "crosses shards" : ""}{restoreCrossShard && restoreAllowBrainOwned ? " and " : ""}{restoreAllowBrainOwned ? "can touch brain:* spawn_ids" : ""}.
                        To commit, enter the phrase <code>{restoreExpectedPhrase}</code> in the Confirm phrase box.
                      </div>
                    </div>
                  ) : null}

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, opacity: 0.85 }}>Snapshot JSON (paste here)</span>
                    <textarea
                      value={restoreJsonText}
                      onChange={(e) => setRestoreJsonText(e.target.value)}
                      placeholder="Paste snapshot JSON here..."
                      rows={8}
                      style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc", fontFamily: "monospace" }}
                    />
                  </label>

                  {restoreConfirmRequired && restoreConfirmExpected ? (
                    <div style={{ padding: 10, borderRadius: 8, border: "1px solid #c62828", background: "#fff5f5" }}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>Confirm required</div>
                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        Re-run commit with confirm token: <code>{restoreConfirmExpected}</code>
                      </div>
                    </div>
                  ) : null}

                  {restoreConfirmPhraseRequired && restoreConfirmPhraseExpected ? (
                    <div style={{ padding: 10, borderRadius: 8, border: "1px solid #c62828", background: "#fff5f5" }}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>Confirm phrase required</div>
                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        Re-run commit with confirm phrase: <code>{restoreConfirmPhraseExpected}</code>
                      </div>
                    </div>
                  ) : null}

                  {restoreResult ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <SummaryPanel
                        title={`Restore ${(restoreResult as any).commit ? "commit" : "dry-run"} summary`}
                        tone={restoreResult.ok ? "good" : "danger"}
                        rows={[
                          ["targetShard", String((restoreResult as any).targetShard ?? "")],
                          ["rows", String((restoreResult as any).rows ?? "")],
                          ["inserted", String((restoreResult as any).inserted ?? (restoreResult as any).wouldInsert ?? "")],
                          ["updated", String((restoreResult as any).updated ?? (restoreResult as any).wouldUpdate ?? "")],
                          ["skipped", String((restoreResult as any).skipped ?? (restoreResult as any).wouldSkip ?? "")],
                          ["skippedReadOnly", String((restoreResult as any).skippedReadOnly ?? (restoreResult as any).wouldReadOnly ?? "")],
                        ]}
                      />

                      {(restoreResult as any).opsPreview ? (
                        <OpsPreviewPanel
                          title="Restore ops preview"
                          preview={(restoreResult as any).opsPreview}
                          downloadName="spawn_slice_restore_ops_preview.json"
                        />
                      ) : null}

                      <details>
                        <summary style={{ cursor: "pointer", userSelect: "none", opacity: 0.9 }}>Raw response JSON</summary>
                        <pre style={{ marginTop: 10, background: "#111", color: "#eee", border: "1px solid #333", padding: 8, borderRadius: 6, overflow: "auto" }}>
                          {JSON.stringify(restoreResult, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

            </>
          ) : null}

          {/* List */}
          <div style={{ maxHeight: 640, overflow: "auto", paddingRight: 6 }}>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {visibleSpawnPoints.map((sp) => {
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

              {visibleSpawnPoints.length === 0 && <li>No spawn points returned.</li>}
            </ul>
          </div>
        </div>

        {activeTab === "tools" ? (
          <div style={{ flex: 1, position: "sticky", top: 12, alignSelf: "flex-start", maxHeight: "calc(100vh - 140px)", overflow: "auto" }}>
            <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Batch Tools</div>
              <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.4 }}>
                Select rows on the left, then use <b>Bulk Move/Delete</b> or <b>Clone/Scatter</b>.
                <div style={{ marginTop: 8 }}>
                  <div>
                    Selected: <b>{selectedIds.length}</b>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    Note: <code>brain:</code> rows are always protected.
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
<div style={{ flex: 1, position: "sticky", top: 12, alignSelf: "flex-start", maxHeight: "calc(100vh - 140px)", overflow: "auto" }}>
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
        )}
      </div>
      )}
    </div>
  );

type OpsPreviewBucket = { count: number; spawnIds: string[]; truncated: boolean };

type AnyOpsPreview =
  | {
      // bucket-style (client-normalized)
      deletes?: OpsPreviewBucket;
      inserts?: OpsPreviewBucket;
      updates?: OpsPreviewBucket;
      skips?: OpsPreviewBucket;
      duplicates?: OpsPreviewBucket;
      droppedBudget?: OpsPreviewBucket;
      readOnly?: OpsPreviewBucket;
    }
  | {
      // list-style (server payload)
      limit: number;
      truncated: boolean;
      deleteSpawnIds?: string[];
      insertSpawnIds?: string[];
      updateSpawnIds?: string[];
      skipSpawnIds?: string[];
      duplicatePlannedSpawnIds?: string[];
      droppedPlannedSpawnIds?: string[];
      readOnlySpawnIds?: string[];
    };


function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

function normalizeOpsPreview(preview: AnyOpsPreview): Exclude<AnyOpsPreview, { limit: number }> {
  const anyPreview: any = preview as any;

  // If it already looks like bucket-style, trust it.
  if (anyPreview && (anyPreview.deletes || anyPreview.inserts || anyPreview.updates || anyPreview.skips || anyPreview.readOnly)) {
    return anyPreview;
  }

  const truncated = Boolean(anyPreview?.truncated);

  const toBucket = (ids: string[] | undefined): OpsPreviewBucket => {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    return { count: list.length, spawnIds: list, truncated };
  };

  return {
    deletes: toBucket(anyPreview?.deleteSpawnIds),
    inserts: toBucket(anyPreview?.insertSpawnIds),
    updates: toBucket(anyPreview?.updateSpawnIds),
    skips: toBucket(anyPreview?.skipSpawnIds),
    duplicates: toBucket(anyPreview?.duplicatePlannedSpawnIds),
    droppedBudget: toBucket(anyPreview?.droppedPlannedSpawnIds),
    readOnly: toBucket(anyPreview?.readOnlySpawnIds),
  };
}

function OpsPreviewPanel(props: { title: string; preview: AnyOpsPreview; downloadName: string }) {
  const { title, preview, downloadName } = props;
  const norm = normalizeOpsPreview(preview) as any;

  const buckets: Array<[string, OpsPreviewBucket]> = [
    ["delete", norm.deletes],
    ["insert", norm.inserts],
    ["update", norm.updates],
    ["skip", norm.skips],
    ["readOnly", norm.readOnly],
    ["duplicates", norm.duplicates],
    ["droppedBudget", norm.droppedBudget],
  ];

  return (
    <div style={{ marginTop: 10, border: "1px solid #333", borderRadius: 8, padding: 10, background: "#0b0b0b" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>{title}</div>
        <button
          type="button"
          onClick={() => downloadJson(downloadName, preview)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #555", background: "#141414", color: "#eee" }}
        >
          Export JSON
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginTop: 10 }}>
        {buckets
          .filter(([, b]) => b.count > 0 || b.spawnIds.length > 0)
          .map(([label, b]) => (
            <div key={label} style={{ border: "1px solid #222", borderRadius: 8, padding: 8, background: "#0f0f0f" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 6 }}>
                <span>{label}</span>
                <span style={{ opacity: 0.9 }}>
                  {b.count}
                  {b.truncated ? "+" : ""}
                </span>
              </div>
              {b.spawnIds.length ? (
                <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid #222", borderRadius: 6, padding: 6, background: "#0b0b0b" }}>
                  {b.spawnIds.map((id) => (
                    <div key={id} style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.95 }}>
                      {id}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.6 }}>none</div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
}