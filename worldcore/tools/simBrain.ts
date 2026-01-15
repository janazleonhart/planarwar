// worldcore/tools/simBrain.ts
/* eslint-disable no-console */

import * as fs from "fs/promises";
import * as path from "path";

import { db } from "../db/Database";

import { planInitialOutposts } from "../sim/SettlementPlanner";
import type { FactionSeedSpec, SettlementPlanConfig } from "../sim/SettlementPlanner";

import type { Bounds } from "../sim/SimGrid";

import { computeRespawnCoverage } from "../sim/RespawnCoverage";
import type { CellCoverageRow, CoverageSummary, SpawnForCoverage } from "../sim/RespawnCoverage";

import { planGapFillSpawns } from "../sim/GapFiller";
import type { GapFillPlanConfig, GapFillSpawn } from "../sim/GapFiller";

import { tierForPointDistanceMode } from "../sim/TownTierSeeding";

import { planTownBaselines } from "../sim/TownBaselinePlanner";
import type { TownBaselinePlanOptions, TownLikeSpawnRow } from "../sim/TownBaselinePlanner";

// Prefer the canonical action types if present in your repo.
// If your BrainActions.ts exports these, keep this import.
// If it doesn't (older branch), you can remove it and fallback to local types.
import type { PlaceSpawnAction } from "../sim/BrainActions";

type BrainAction = PlaceSpawnAction | { kind: string; [k: string]: unknown };

type Cmd =
  | "preview"
  | "apply"
  | "report"
  | "status"
  | "town-baseline"
  | "fill-gaps"
  | "era"
  | "trim-outposts"
  | "snapshot-spawns"
  | "restore-spawns"
  | "wipe-placements"
  | "help"
  | "set-town-tiers"
;

function usage(): void {
  console.log(
    `
Planar War — Dev Simulation Harness (WorldCore)

Usage:
  node dist/worldcore/tools/simBrain.js preview [options]
  node dist/worldcore/tools/simBrain.js apply [options] [--commit]
  node dist/worldcore/tools/simBrain.js report [options]
  node dist/worldcore/tools/simBrain.js status [options]
  node dist/worldcore/tools/simBrain.js town-baseline [options] [--commit]
  node dist/worldcore/tools/simBrain.js fill-gaps [options] [--commit]
  node dist/worldcore/tools/simBrain.js era [options] [--commit]
  node dist/worldcore/tools/simBrain.js trim-outposts [options] [--commit]
  node dist/worldcore/tools/simBrain.js snapshot-spawns [options]
  node dist/worldcore/tools/simBrain.js restore-spawns --in <file> [options] [--commit]
  node dist/worldcore/tools/simBrain.js wipe-placements [options] [--commit]

Common options:
  --shard       shard id (default: prime_shard)
  --bounds      cell bounds (default: -4..4,-4..4)
  --cellSize    cell size in world units (default: 64)

Town baseline options (town-baseline):
  --townTypes       comma list (default: town,outpost,hub,village,city,settlement,camp)
  --noMailbox       do not seed mailbox baseline
  --mailboxProtoId  (default: mailbox_basic)
  --mailboxRadius   (default: 8)
  --noRest          do not seed rest baseline
  --restProtoId     (default: rest_spot_basic)
  --restRadius      (default: 10)
  --noStations      do not seed crafting stations
  --stations        comma list of station protoIds (default: station_forge,station_alchemy,station_oven,station_mill)
  --stationRadius   (default: 9)

  --respectTierStations  enable tier-gated station seeding (default: off)
  --townTier        override tier for all towns (default: infer)
  --guardCount      NPC guards per town (default: 2)
  --guardProtoId    (default: town_guard)
  --guardRadius     (default: 12)

Safety:
  --commit                commit to DB (otherwise rollback)
  --updateExisting        allow updating existing spawn_ids (default: insert-only)
  --allowDefaultBounds    allow --commit without explicitly passing --bounds (default: false)

Planner options (preview/apply/era):
  --seed        deterministic seed (default: seed:alpha)
  --minCellDistance spacing in CELLS (default: 3)
  --borderMargin   in-cell border margin (default: 16)
  --factions    e.g. emberfall:2,oathbound:3
  --spawnType   default: outpost
  --protoId     default: outpost
  --archetype   default: outpost

Safe-mode outpost controls:
  --append              SAFE MODE: only ADD new outposts (never touch existing outpost_* spawns)
  --factionsAreTotal    interpret --factions counts as TOTAL desired per faction (existing+new)
  --maxOutpostsPerFaction N  clamp total outposts per faction to N (existing+new)

Report options:
  --respawnRadius  world units radius for "covered" (default: 500)
  --top            show worst N gaps (default: 25)

Status options:
  --respawnRadius  (default: 500)
  --topGaps        show worst N uncovered cells inline (default: 0)

Fill-gaps options:
  --seed           deterministic seed (default: seed:gapfill)
  --respawnRadius  coverage radius (default: 500)
  --minDistance    min distance between checkpoints/graveyards (default: 300)
  --maxPlace       max new spawns to place (default: 50)
  --spawnType      checkpoint|graveyard (default: checkpoint)
  --protoId        default: (spawnType)
  --archetype      default: (spawnType)
  --borderMargin   in-cell border margin (default: 16)
  --json           print planned actions JSON

Era options (orchestrated run):
  --respawnRadius       (default: 500)
  --gapSeed            (default: seed:gapfill)
  --minDistance        (default: 300)
  --maxPlace           (default: 50)
  --gapSpawnType       checkpoint|graveyard (default: checkpoint)
  --gapProtoId         default: (gapSpawnType)
  --gapArchetype       default: (gapSpawnType)
  --gapBorderMargin    default: --borderMargin
  --artifactDir        default: ./artifacts/brain
  --noArtifact         don't write artifact file
  --json               print artifact JSON (still writes unless --noArtifact)

Snapshot-spawns options:
  --types          comma list of spawn_points.type to snapshot (default: outpost,checkpoint,graveyard,town,npc)
  --pad            world-units expansion of bounds box (default: 0)
  --artifactDir    default: ./artifacts/brain
  --noArtifact     don't write snapshot file
  --json           print snapshot JSON (still writes unless --noArtifact)

Restore-spawns options:
  --in             required. snapshot file produced by snapshot-spawns
  --shard          target shard override (default: prime_shard)
  --updateExisting allow updating existing spawn_ids (default: false)

Wipe-placements options:
  --types          comma list of spawn_points.type to delete (default: outpost,checkpoint,graveyard)
  --pad            world-units expansion of bounds box (default: 0)
  --artifactDir    default: ./artifacts/brain
  --noArtifact     don't write artifact file
  --json           print artifact JSON (still writes unless --noArtifact)

Trim-outposts options:
  --maxPerFaction  required. keep at most N outposts per faction (within bounds)
  --pad            world-units expansion of bounds box (default: 0)
  --artifactDir    default: ./artifacts/brain
  --noArtifact     don't write artifact file
  --json           print artifact JSON (still writes unless --noArtifact)

Examples:
  node dist/worldcore/tools/simBrain.js status --bounds -8..8,-8..8 --topGaps 5
`.trim(),
  );
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function getFlag(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  const v = argv[idx + 1];
  if (!v || v.startsWith("--")) return null;
  return v;
}

function parseIntFlag(argv: string[], name: string, fallback: number): number {
  const raw = getFlag(argv, name);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseRange(s: string): [number, number] {
  const [loRaw, hiRaw] = s.split("..").map((x) => x.trim());
  const lo = parseInt(loRaw || "0", 10);
  const hi = parseInt(hiRaw ?? loRaw ?? "0", 10);
  const a = Number.isFinite(lo) ? lo : 0;
  const b = Number.isFinite(hi) ? hi : a;
  return [Math.min(a, b), Math.max(a, b)];
}

function parseBounds(input: string): Bounds {
  const [a, b] = input.split(",").map((s) => s.trim());
  const [minCx, maxCx] = parseRange(a);
  const [minCz, maxCz] = parseRange(b);
  return { minCx, maxCx, minCz, maxCz };
}

function parseCenter(input: string): [number, number] {
  const parts = String(input ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const x = Number(parts[0] ?? "0");
  const z = Number(parts[1] ?? "0");

  return [Number.isFinite(x) ? x : 0, Number.isFinite(z) ? z : 0];
}

function parseFactions(input: string): FactionSeedSpec[] {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const out: FactionSeedSpec[] = [];
  for (const p of parts) {
    const [idRaw, countRaw] = p.split(":").map((x) => x.trim());
    const factionId = idRaw || "unknown";
    const count = Math.max(0, parseInt(countRaw || "0", 10) | 0);
    out.push({ factionId, count });
  }
  return out;
}

function parseTypes(input: string | null, fallback: string[]): string[] {
  const raw = (input ?? "").trim();
  if (!raw) return [...fallback];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isoSlug(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

function boundsSlug(b: Bounds): string {
  return `${b.minCx}..${b.maxCx},${b.minCz}..${b.maxCz}`;
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function assertNoEllipsisArgs(argv: string[]): void {
  if (argv.includes("...") || argv.includes("…")) {
    throw new Error(`Refusing to run: found literal "..." argument. (Remove it; it triggers defaults.)`);
  }
}

function assertCommitHasExplicitBounds(argv: string[], commit: boolean): void {
  if (!commit) return;
  if (hasFlag(argv, "--allowDefaultBounds")) return;
  if (!hasFlag(argv, "--bounds")) {
    throw new Error(`Refusing to --commit without explicit --bounds. (Add --bounds or use --allowDefaultBounds)`);
  }
}

async function writeArtifactFile(dir: string, filename: string, json: unknown): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf8");
  return filePath;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function applyToDb(
  actions: BrainAction[],
  opts: { commit: boolean; updateExisting: boolean },
): Promise<{ inserted: number; updated: number; skipped: number }> {
  const client = await db.connect();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");

    for (const a of actions) {
      if (!a || (a as PlaceSpawnAction).kind !== "place_spawn") continue;

      const s = (a as PlaceSpawnAction).spawn;

      const existing = await client.query(
        `SELECT id FROM spawn_points WHERE shard_id = $1 AND spawn_id = $2 LIMIT 1`,
        [s.shardId, s.spawnId],
      );

      if (existing.rowCount && existing.rows[0]) {
        if (!opts.updateExisting) {
          skipped++;
          continue;
        }

        const id = (existing.rows[0] as { id: number }).id;

        await client.query(
          `
          UPDATE spawn_points
          SET type = $2, archetype = $3, proto_id = $4, variant_id = $5,
              x = $6, y = $7, z = $8, region_id = $9
          WHERE id = $1
        `,
          [id, s.type, s.archetype, s.protoId, s.variantId, s.x, s.y, s.z, s.regionId],
        );

        updated++;
      } else {
        await client.query(
          `
          INSERT INTO spawn_points (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
          [s.shardId, s.spawnId, s.type, s.archetype, s.protoId, s.variantId, s.x, s.y, s.z, s.regionId],
        );

        inserted++;
      }
    }

    if (opts.commit) await client.query("COMMIT");
    else await client.query("ROLLBACK");

    return { inserted, updated, skipped };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function loadSpawnsForArea(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  radiusPad: number;
}): Promise<SpawnForCoverage[]> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const radius = Math.max(0, args.radiusPad);

  const minX = args.bounds.minCx * cellSize - radius;
  const maxX = (args.bounds.maxCx + 1) * cellSize + radius;
  const minZ = args.bounds.minCz * cellSize - radius;
  const maxZ = (args.bounds.maxCz + 1) * cellSize + radius;

  type SpawnRow = {
    spawn_id: string;
    type: string;
    x: number;
    z: number;
    variant_id: string | null;
  };

  const client = await db.connect();
  try {
    const res = await client.query(
      `
      SELECT spawn_id, type, x, z, variant_id
      FROM spawn_points
      WHERE shard_id = $1 AND x >= $2 AND x <= $3 AND z >= $4 AND z <= $5
    `,
      [args.shardId, minX, maxX, minZ, maxZ],
    );

    const rows = res.rows as SpawnRow[];
    return rows.map((r) => ({
      spawnId: String(r.spawn_id),
      type: String(r.type),
      x: Number(r.x),
      z: Number(r.z),
      variantId: r.variant_id == null ? null : String(r.variant_id),
    }));
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// SAFE MODE (append-only) outpost caps
// ---------------------------------------------------------------------------

type OutpostStats = { count: number; maxIndex: number };

async function loadExistingOutpostStats(shardId: string): Promise<Map<string, OutpostStats>> {
  const re = /^outpost_(.+)_([0-9]+)_(-?[0-9]+)_(-?[0-9]+)$/;

  type OutpostRow = { spawn_id: string };

  const client = await db.connect();
  try {
    const res = await client.query(
      `
      SELECT spawn_id
      FROM spawn_points
      WHERE shard_id = $1 AND spawn_id LIKE 'outpost_%'
    `,
      [shardId],
    );

    const map = new Map<string, OutpostStats>();
    const rows = res.rows as OutpostRow[];

    for (const row of rows) {
      const id = String(row.spawn_id ?? "");
      const m = re.exec(id);
      if (!m) continue;

      const factionKey = m[1];
      const index = parseInt(m[2], 10);
      if (!Number.isFinite(index)) continue;

      const cur = map.get(factionKey) ?? { count: 0, maxIndex: -1 };
      cur.count++;
      if (index > cur.maxIndex) cur.maxIndex = index;
      map.set(factionKey, cur);
    }

    return map;
  } finally {
    client.release();
  }
}

function clampOutpostPlan(args: {
  requested: readonly FactionSeedSpec[];
  factionsAreTotal: boolean;
  maxOutpostsPerFaction: number | null;
  append: boolean;
  existing: Map<string, OutpostStats> | null;
}): FactionSeedSpec[] {
  if (!args.append) return [...args.requested];

  const existing = args.existing ?? new Map<string, OutpostStats>();
  const out: FactionSeedSpec[] = [];

  for (const f of args.requested) {
    const key = sanitizeId(f.factionId);
    const st = existing.get(key) ?? { count: 0, maxIndex: -1 };

    const cap =
      args.maxOutpostsPerFaction == null ? Number.POSITIVE_INFINITY : Math.max(0, args.maxOutpostsPerFaction);

    let newCount: number;
    if (args.factionsAreTotal) {
      const desiredTotal = Math.min(Math.max(0, Math.trunc(f.count)), cap);
      newCount = Math.max(0, desiredTotal - st.count);
    } else {
      const requestedNew = Math.max(0, Math.trunc(f.count));
      const allowedNew = Math.max(0, cap - st.count);
      newCount = Math.min(requestedNew, allowedNew);
    }

    if (newCount <= 0) continue;

    const startIndex = Math.max(0, st.maxIndex + 1);
    out.push({ factionId: f.factionId, count: newCount, startIndex });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Coverage helpers
// ---------------------------------------------------------------------------

function computeGaps(rows: readonly CellCoverageRow[]): CellCoverageRow[] {
  return rows
    .filter((r) => !r.covered)
    .sort((a, b) => (b.nearestDistance ?? 0) - (a.nearestDistance ?? 0));
}

async function runReport(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  respawnRadius: number;
  top: number;
}): Promise<void> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const radius = Math.max(0, args.respawnRadius);

  const spawns = await loadSpawnsForArea({
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    radiusPad: radius,
  });

  const report = computeRespawnCoverage(spawns, {
    bounds: args.bounds,
    cellSize,
    respawnRadius: radius,
  });

  console.log(
    `[report] shard=${args.shardId} bounds=${boundsSlug(args.bounds)} cellSize=${cellSize} radius=${radius} spawns_scanned=${spawns.length}`,
  );
  console.log(
    `[report] cells=${report.summary.totalCells} covered=${report.summary.coveredCells} gaps=${report.summary.gapCells} coverage=${report.summary.coveragePct.toFixed(
      2,
    )}%`,
  );

  const gaps = computeGaps(report.rows);
  const top = Math.max(0, Math.min(args.top, gaps.length));
  if (top === 0) {
    console.log("[report] no gaps found (within radius).");
    return;
  }

  console.log(`[report] worst gaps (top ${top}):`);
  for (let i = 0; i < top; i++) {
    const g = gaps[i];
    const near = g.nearestSpawnId ? `${g.nearestSpawnId} (${g.nearestSpawnType})` : "none";
    const dist = Number.isFinite(g.nearestDistance) ? g.nearestDistance.toFixed(2) : "Infinity";
    console.log(
      `- cell=${g.cx},${g.cz} center=(${g.centerX.toFixed(2)},${g.centerZ.toFixed(2)}) nearest=${near} dist=${dist}`,
    );
  }
}

function countOutpostsByFactionFromSpawnId(spawns: readonly SpawnForCoverage[]): Map<string, number> {
  const re = /^outpost_(.+)_([0-9]+)_(-?[0-9]+)_(-?[0-9]+)$/;
  const m = new Map<string, number>();

  for (const s of spawns) {
    if (s.type !== "outpost") continue;
    const mm = re.exec(s.spawnId);
    const faction = mm?.[1] ?? "__unknown__";
    m.set(faction, (m.get(faction) ?? 0) + 1);
  }

  return m;
}

async function runStatus(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  respawnRadius: number;
  topGaps?: number;
}): Promise<void> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const radius = Math.max(0, args.respawnRadius);
  const topGaps = Math.max(0, Math.floor(args.topGaps ?? 0));

  const spawns = await loadSpawnsForArea({
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    radiusPad: radius,
  });

  const countsByType = new Map<string, number>();
  for (const s of spawns) {
    countsByType.set(s.type, (countsByType.get(s.type) ?? 0) + 1);
  }

  const outpostsByFaction = countOutpostsByFactionFromSpawnId(spawns);

  const cov = computeRespawnCoverage(spawns, {
    bounds: args.bounds,
    cellSize,
    respawnRadius: radius,
  });

  console.log(`[status] shard=${args.shardId} bounds=${boundsSlug(args.bounds)} cellSize=${cellSize} respawnRadius=${radius}`);

  const typesSorted = [...countsByType.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`[status] spawn types in scan area:`);
  for (const [t, n] of typesSorted) console.log(`  - ${t}: ${n}`);

  const factionsSorted = [...outpostsByFaction.entries()].sort((a, b) => b[1] - a[1]);
  if (factionsSorted.length) {
    console.log(`[status] outposts by faction:`);
    for (const [f, n] of factionsSorted) console.log(`  - ${f}: ${n}`);
  } else {
    console.log(`[status] outposts by faction: (none)`);
  }

  const s = cov.summary as CoverageSummary;
  console.log(
    `[status] coverage: cells=${s.totalCells} covered=${s.coveredCells} gaps=${s.gapCells} pct=${s.coveragePct.toFixed(2)}%`,
  );

  if (topGaps > 0 && s.gapCells > 0) {
    const gaps = computeGaps(cov.rows);
    const n = Math.min(topGaps, gaps.length);
    console.log(`[status] worst gaps (top ${n}):`);
    for (let i = 0; i < n; i++) {
      const g = gaps[i];
      const near = g.nearestSpawnId ? `${g.nearestSpawnId} (${g.nearestSpawnType})` : "none";
      const dist = Number.isFinite(g.nearestDistance) ? g.nearestDistance.toFixed(2) : "Infinity";
      console.log(
        `  - cell=${g.cx},${g.cz} center=(${g.centerX.toFixed(2)},${g.centerZ.toFixed(2)}) nearest=${near} dist=${dist}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Town baseline seeding
// ---------------------------------------------------------------------------
async function runTownBaseline(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  townTypes: string[];
  seedMailbox: boolean;
  mailboxProtoId: string;
  mailboxRadius: number;
  seedRest: boolean;
  restProtoId: string;
  restRadius: number;
  seedStations: boolean;
  stationProtoIds: string[];
  stationRadius: number;
  townTier?: number | null;
  respectTierStations?: boolean;
  guardCount: number;
  guardProtoId: string;
  guardRadius: number;
  // Training dummy options (optional; defaults kick in below)
  dummyCount?: number;
  dummyProtoId?: string;
  dummyRadius?: number;
  commit: boolean;
  updateExisting: boolean;
}): Promise<void> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const minX = args.bounds.minCx * cellSize;
  const maxX = (args.bounds.maxCx + 1) * cellSize;
  const minZ = args.bounds.minCz * cellSize;
  const maxZ = (args.bounds.maxCz + 1) * cellSize;

  const types = (args.townTypes ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (!types.length) {
    throw new Error("town-baseline requires --townTypes to resolve at least one type");
  }

  const client = await db.connect();
  let rows: any[] = [];
  try {
    const res = await client.query(
      `
      SELECT shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id, town_tier
      FROM spawn_points
      WHERE shard_id = $1
        AND x >= $2 AND x < $3
        AND z >= $4 AND z < $5
        AND type = ANY($6::text[])
      ORDER BY spawn_id
      `,
      [args.shardId, minX, maxX, minZ, maxZ, types],
    );
    rows = res.rows ?? [];
  } finally {
    client.release();
  }

  const towns: TownLikeSpawnRow[] = rows.map((r: any) => ({
    shardId: String(r.shard_id),
    spawnId: String(r.spawn_id),
    type: String(r.type),
    archetype: r.archetype != null ? String(r.archetype) : undefined,
    protoId: r.proto_id != null ? String(r.proto_id) : undefined,
    variantId: r.variant_id != null ? String(r.variant_id) : null,
    x: Number(r.x ?? 0),
    y: Number(r.y ?? 0),
    z: Number(r.z ?? 0),
    regionId: r.region_id ? String(r.region_id) : null,
    townTier: r.town_tier != null ? Number(r.town_tier) : null,
  }));

  // Defaults: 1 big dummy per town, radius ~10 units
  const dummyCount = Math.max(0, Math.floor(args.dummyCount ?? 1));
  const dummyProtoId = args.dummyProtoId ?? "training_dummy_big";
  const dummyRadius = Math.max(0, args.dummyRadius ?? 10);

  const opts: TownBaselinePlanOptions = {
    bounds: args.bounds,
    cellSize,
    townTypes: types,

    seedMailbox: args.seedMailbox,
    mailboxType: "mailbox",
    mailboxProtoId: args.mailboxProtoId,
    mailboxRadius: Math.max(0, args.mailboxRadius),

    seedRest: args.seedRest,
    restType: "rest",
    restProtoId: args.restProtoId,
    restRadius: Math.max(0, args.restRadius),

    seedStations: args.seedStations,
    stationType: "station",
    stationProtoIds: args.stationProtoIds,
    stationRadius: Math.max(0, args.stationRadius),
    townTierOverride: args.townTier ?? null,
    respectTownTierStations: Boolean(args.respectTierStations),

    guardCount: Math.max(0, Math.floor(args.guardCount)),
    guardProtoId: args.guardProtoId,
    guardRadius: Math.max(0, args.guardRadius),

    dummyCount,
    dummyProtoId,
    dummyRadius,
  };

  const plan = planTownBaselines(towns, opts);

  console.log(
    `[town-baseline] shard=${args.shardId} bounds=${boundsSlug(
      args.bounds,
    )} towns=${plan.townsConsidered} actions=${plan.actions.length} mailbox=${
      opts.seedMailbox ? "on" : "off"
    } rest=${opts.seedRest ? "on" : "off"} stations=${opts.seedStations ? (opts.stationProtoIds?.length ?? 0) : 0} tierStations=${args.respectTierStations ? "on" : "off"} townTier=${args.townTier ?? "infer"} guards=${opts.guardCount} dummies=${
      opts.dummyCount
    }`,
  );

  const res = await applyToDb(plan.actions as unknown as BrainAction[], {
    commit: args.commit,
    updateExisting: args.updateExisting,
  });

  if (args.commit) {
    console.log(
      `[town-baseline] committed.\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped}`,
    );
  } else {
    console.log(
      `[town-baseline] dry-run rolled back.\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped} (use --commit)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fill gaps
// ---------------------------------------------------------------------------

async function runFillGaps(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  seed: string;
  respawnRadius: number;
  minDistance: number;
  maxPlace: number;
  spawnType: "checkpoint" | "graveyard";
  protoId: string;
  archetype: string;
  borderMargin: number;
  json: boolean;
  commit: boolean;
  updateExisting: boolean;
}): Promise<void> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const radius = Math.max(0, args.respawnRadius);

  const existing = await loadSpawnsForArea({
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    radiusPad: radius,
  });

  const cfg: GapFillPlanConfig = {
    seed: args.seed,
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    baseY: 0,
    borderMargin: args.borderMargin,
    respawnRadius: args.respawnRadius,
    minDistance: args.minDistance,
    maxPlace: args.maxPlace,
    spawnType: args.spawnType,
    protoId: args.protoId,
    archetype: args.archetype,
  };

  const planned = planGapFillSpawns(existing, cfg);
  const actions: BrainAction[] = planned.map((p) => ({ kind: "place_spawn", spawn: p }));

  if (args.json) console.log(JSON.stringify(actions, null, 2));
  else
    console.log(
      `[fill-gaps] planned=${planned.length} seed=${args.seed} shard=${args.shardId} radius=${args.respawnRadius} minDist=${args.minDistance} maxPlace=${args.maxPlace}`,
    );

  if (planned.length === 0) {
    console.log("[fill-gaps] nothing to place.");
    return;
  }

  const res = await applyToDb(actions, { commit: args.commit, updateExisting: args.updateExisting });
  if (args.commit) {
    console.log(`[simBrain] committed.\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped}`);
  } else {
    console.log(
      `[simBrain] rolled back (dry-run).\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped} (use --commit)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Era
// ---------------------------------------------------------------------------

function mergePlannedSpawns(existing: SpawnForCoverage[], actions: BrainAction[]): SpawnForCoverage[] {
  const map = new Map<string, SpawnForCoverage>();
  for (const s of existing) map.set(s.spawnId, s);

  for (const a of actions) {
    if (!a || (a as PlaceSpawnAction).kind !== "place_spawn") continue;
    const sp = (a as PlaceSpawnAction).spawn;

    map.set(sp.spawnId, {
      spawnId: sp.spawnId,
      type: sp.type,
      x: sp.x,
      z: sp.z,
      variantId: sp.variantId ?? null,
    });
  }

  return [...map.values()];
}

async function runEra(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;

  seed: string;
  borderMargin: number;
  minCellDistance: number;
  spawnType: string;
  protoId: string;
  archetype: string;

  requestedFactions: FactionSeedSpec[];
  factionsAreTotal: boolean;
  appendFlag: boolean;
  maxOutpostsPerFaction: number | null;

  respawnRadius: number;
  gapSeed: string;
  minDistance: number;
  maxPlace: number;
  gapSpawnType: "checkpoint" | "graveyard";
  gapProtoId: string;
  gapArchetype: string;
  gapBorderMargin: number;

  artifactDir: string;
  noArtifact: boolean;
  json: boolean;

  commit: boolean;
  updateExisting: boolean;
}): Promise<void> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const radius = Math.max(0, args.respawnRadius);

  const baselineSpawns = await loadSpawnsForArea({
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    radiusPad: radius,
  });

  const before = computeRespawnCoverage(baselineSpawns, {
    bounds: args.bounds,
    cellSize,
    respawnRadius: radius,
  });

  const append = args.appendFlag || args.factionsAreTotal || args.maxOutpostsPerFaction != null;

  const existingStats = append ? await loadExistingOutpostStats(args.shardId) : null;
  const effectiveFactions = clampOutpostPlan({
    requested: args.requestedFactions,
    factionsAreTotal: args.factionsAreTotal,
    maxOutpostsPerFaction: args.maxOutpostsPerFaction,
    append,
    existing: existingStats,
  });

  if (append) {
    const want = args.requestedFactions.map((f) => `${f.factionId}:${f.count}`).join(",") || "(none)";
    const eff =
      effectiveFactions.map((f) => `${f.factionId}:${f.count}@${f.startIndex ?? 0}`).join(",") || "(none)";
    console.log(
      `[planner] safeMode=on factionsAreTotal=${String(args.factionsAreTotal)} maxOutpostsPerFaction=${
        args.maxOutpostsPerFaction == null ? "∞" : String(args.maxOutpostsPerFaction)
      }`,
    );
    console.log(`[planner] requested=${want}`);
    console.log(`[planner] effective=${eff}`);
  }

  const outpostCfg: SettlementPlanConfig = {
    seed: args.seed,
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    baseY: 0,
    borderMargin: args.borderMargin,
    minCellDistance: args.minCellDistance,
    spawnType: args.spawnType,
    protoId: args.protoId,
    archetype: args.archetype,
  };

  const outpostActions = planInitialOutposts(effectiveFactions, outpostCfg) as unknown as BrainAction[];
  const spawnsAfterOutposts = mergePlannedSpawns(baselineSpawns, outpostActions);

  const gapCfg: GapFillPlanConfig = {
    seed: args.gapSeed,
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    baseY: 0,
    borderMargin: args.gapBorderMargin,
    respawnRadius: radius,
    minDistance: args.minDistance,
    maxPlace: args.maxPlace,
    spawnType: args.gapSpawnType,
    protoId: args.gapProtoId,
    archetype: args.gapArchetype,
  };

  const plannedGapSpawns = planGapFillSpawns(spawnsAfterOutposts, gapCfg);
  const gapActions: BrainAction[] = plannedGapSpawns.map((p) => ({ kind: "place_spawn", spawn: p }));

  const spawnsAfterAll = mergePlannedSpawns(spawnsAfterOutposts, gapActions);

  const after = computeRespawnCoverage(spawnsAfterAll, {
    bounds: args.bounds,
    cellSize,
    respawnRadius: radius,
  });

  const artifact = {
    kind: "simBrain.era",
    version: 3,
    createdAt: new Date().toISOString(),
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    commit: args.commit,
    updateExisting: args.updateExisting,

    outposts: {
      safeMode: append,
      seed: args.seed,
      borderMargin: args.borderMargin,
      minCellDistance: args.minCellDistance,
      requested: args.requestedFactions,
      effective: effectiveFactions,
      plannedCount: outpostActions.filter((a) => (a as PlaceSpawnAction).kind === "place_spawn").length,
    },

    gapFill: {
      seed: args.gapSeed,
      respawnRadius: radius,
      minDistance: args.minDistance,
      maxPlace: args.maxPlace,
      spawnType: args.gapSpawnType,
      protoId: args.gapProtoId,
      archetype: args.gapArchetype,
      borderMargin: args.gapBorderMargin,
      plannedCount: plannedGapSpawns.length,
    },

    coverage: {
      before: before.summary as CoverageSummary,
      after: after.summary as CoverageSummary,
    },

    actions: [...outpostActions, ...gapActions],
  };

  console.log(`[era] shard=${args.shardId} bounds=${boundsSlug(args.bounds)} cellSize=${cellSize} respawnRadius=${radius}`);
  console.log(
    `[era] outposts_planned=${artifact.outposts.plannedCount} gapfills_planned=${artifact.gapFill.plannedCount} commit=${String(
      args.commit,
    )}`,
  );
  console.log(
    `[era] coverage before=${artifact.coverage.before.coveragePct.toFixed(2)}% after=${artifact.coverage.after.coveragePct.toFixed(2)}%`,
  );

  const filename = `era_${isoSlug()}_${args.shardId}_${boundsSlug(args.bounds)}.json`;

  if (args.json) console.log(JSON.stringify(artifact, null, 2));
  if (!args.noArtifact) {
    const outPath = await writeArtifactFile(args.artifactDir, filename, artifact);
    console.log(`[era] artifact=${outPath}`);
  }

  const actionsToApply = [...outpostActions, ...gapActions];
  if (actionsToApply.length === 0) {
    console.log("[era] nothing to apply.");
    return;
  }

  const res = await applyToDb(actionsToApply, { commit: args.commit, updateExisting: args.updateExisting });
  if (args.commit) {
    console.log(`[simBrain] committed.\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped}`);
  } else {
    console.log(
      `[simBrain] rolled back (dry-run).\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped} (use --commit)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Snapshot / Restore spawns
// ---------------------------------------------------------------------------

type SnapshotSpawnRow = {
  shardId: string;
  spawnId: string;
  type: string;
  protoId: string;
  archetype: string;
  variantId: string | null;
  x: number;
  y: number;
  z: number;
  regionId: string;
};

async function runSnapshotSpawns(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  pad: number;
  types: string[];
  artifactDir: string;
  noArtifact: boolean;
  json: boolean;
}): Promise<void> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const pad = Math.max(0, Math.floor(args.pad));

  const minX = args.bounds.minCx * cellSize - pad;
  const maxX = (args.bounds.maxCx + 1) * cellSize + pad;
  const minZ = args.bounds.minCz * cellSize - pad;
  const maxZ = (args.bounds.maxCz + 1) * cellSize + pad;

  type Row = {
    shard_id: string;
    spawn_id: string;
    type: string;
    proto_id: string;
    archetype: string;
    variant_id: string | null;
    x: number;
    y: number;
    z: number;
    region_id: string;
  };

  const client = await db.connect();
  let rows: Row[] = [];
  try {
    const res = await client.query(
      `
      SELECT shard_id, spawn_id, type, proto_id, archetype, variant_id, x, y, z, region_id
      FROM spawn_points
      WHERE shard_id = $1
        AND type = ANY($2::text[])
        AND x >= $3 AND x <= $4
        AND z >= $5 AND z <= $6
      ORDER BY type, spawn_id
    `,
      [args.shardId, args.types, minX, maxX, minZ, maxZ],
    );

    rows = res.rows as Row[];
  } finally {
    client.release();
  }

  const spawns: SnapshotSpawnRow[] = rows.map((r) => ({
    shardId: String(r.shard_id),
    spawnId: String(r.spawn_id),
    type: String(r.type),
    protoId: String(r.proto_id),
    archetype: String(r.archetype),
    variantId: r.variant_id == null ? null : String(r.variant_id),
    x: Number(r.x),
    y: Number(r.y),
    z: Number(r.z),
    regionId: String(r.region_id),
  }));

  const snapshot = {
    kind: "simBrain.snapshot-spawns",
    version: 1,
    createdAt: new Date().toISOString(),
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    pad,
    types: args.types,
    rows: spawns.length,
    spawns,
  };

  console.log(
    `[snapshot] shard=${args.shardId} bounds=${boundsSlug(args.bounds)} cellSize=${cellSize} pad=${pad} types=${args.types.join(",")}`,
  );
  console.log(`[snapshot] rows=${spawns.length}`);

  const filename = `snapshot_${isoSlug()}_${args.shardId}_${boundsSlug(args.bounds)}.json`;

  if (args.json) console.log(JSON.stringify(snapshot, null, 2));
  if (!args.noArtifact) {
    const outPath = await writeArtifactFile(args.artifactDir, filename, snapshot);
    console.log(`[snapshot] file=${outPath}`);
  }
}

function coerceSnapshotSpawns(doc: unknown): { snapshotShard: string; spawns: SnapshotSpawnRow[] } {
  if (!doc || typeof doc !== "object") throw new Error("Invalid snapshot: not an object.");
  const anyDoc = doc as Record<string, unknown>;

  const shardIdRaw = anyDoc["shardId"];
  const snapshotShard = typeof shardIdRaw === "string" && shardIdRaw.length ? shardIdRaw : "prime_shard";

  const spawnsRaw = anyDoc["spawns"];
  if (!Array.isArray(spawnsRaw)) throw new Error("Invalid snapshot: missing 'spawns' array.");

  const spawns: SnapshotSpawnRow[] = [];
  for (const it of spawnsRaw) {
    const o = it as Record<string, unknown>;
    const spawnId = String(o["spawnId"] ?? "");
    if (!spawnId) continue;
    spawns.push({
      shardId: String(o["shardId"] ?? snapshotShard),
      spawnId,
      type: String(o["type"] ?? "unknown"),
      protoId: String(o["protoId"] ?? o["proto_id"] ?? "unknown"),
      archetype: String(o["archetype"] ?? "unknown"),
      variantId: o["variantId"] == null ? null : String(o["variantId"]),
      x: Number(o["x"] ?? 0),
      y: Number(o["y"] ?? 0),
      z: Number(o["z"] ?? 0),
      regionId: String(o["regionId"] ?? o["region_id"] ?? ""),
    });
  }

  return { snapshotShard, spawns };
}

async function runRestoreSpawns(args: {
  inFile: string;
  targetShard: string;
  commit: boolean;
  updateExisting: boolean;
}): Promise<void> {
  console.log(`[restore] in=${args.inFile}`);

  const doc = await readJsonFile(args.inFile);
  const { snapshotShard, spawns } = coerceSnapshotSpawns(doc);

  const targetShard = args.targetShard || snapshotShard;

  console.log(
    `[restore] snapshot_shard=${snapshotShard} target_shard=${targetShard} rows=${spawns.length} commit=${String(
      args.commit,
    )} updateExisting=${String(args.updateExisting)}`,
  );

  const actions: BrainAction[] = spawns.map((s) => ({
    kind: "place_spawn",
    spawn: {
      shardId: targetShard,
      spawnId: s.spawnId,
      type: s.type,
      protoId: s.protoId,
      archetype: s.archetype,
      variantId: s.variantId,
      x: s.x,
      y: s.y,
      z: s.z,
      regionId: s.regionId,
    },
  }));

  const res = await applyToDb(actions, { commit: args.commit, updateExisting: args.updateExisting });

  if (args.commit) console.log(`[restore] committed.\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped}`);
  else
    console.log(
      `[restore] rolled back (dry-run).\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped} (use --commit)`,
    );
}

// ---------------------------------------------------------------------------
// Wipe placements
// ---------------------------------------------------------------------------

async function runWipePlacements(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  pad: number;
  types: string[];
  artifactDir: string;
  noArtifact: boolean;
  json: boolean;
  commit: boolean;
}): Promise<void> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const pad = Math.max(0, Math.floor(args.pad));

  const minX = args.bounds.minCx * cellSize - pad;
  const maxX = (args.bounds.maxCx + 1) * cellSize + pad;
  const minZ = args.bounds.minCz * cellSize - pad;
  const maxZ = (args.bounds.maxCz + 1) * cellSize + pad;

  type Row = { spawn_id: string; type: string; x: number; z: number; region_id: string | null };

  const client = await db.connect();
  let rows: Row[] = [];
  try {
    const res = await client.query(
      `
      SELECT spawn_id, type, x, z, region_id
      FROM spawn_points
      WHERE shard_id = $1
        AND type = ANY($2::text[])
        AND x >= $3 AND x <= $4
        AND z >= $5 AND z <= $6
      ORDER BY type, spawn_id
    `,
      [args.shardId, args.types, minX, maxX, minZ, maxZ],
    );

    rows = res.rows as Row[];
  } finally {
    client.release();
  }

  const artifact = {
    kind: "simBrain.wipe-placements",
    version: 2,
    createdAt: new Date().toISOString(),
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    pad,
    types: args.types,
    matched: rows.length,
    commit: args.commit,
    sample: rows.slice(0, 50).map((r) => ({
      spawnId: r.spawn_id,
      type: r.type,
      x: Number(r.x),
      z: Number(r.z),
      regionId: r.region_id,
    })),
  };

  console.log(
    `[wipe] shard=${args.shardId} bounds=${boundsSlug(args.bounds)} cellSize=${cellSize} pad=${pad} types=${args.types.join(",")}`,
  );
  console.log(`[wipe] matched=${rows.length} commit=${String(args.commit)}`);

  if (args.json) console.log(JSON.stringify(artifact, null, 2));
  if (!args.noArtifact) {
    const filename = `wipe_${isoSlug()}_${args.shardId}_${boundsSlug(args.bounds)}.json`;
    const outPath = await writeArtifactFile(args.artifactDir, filename, artifact);
    console.log(`[wipe] artifact=${outPath}`);
  }

  if (rows.length === 0) {
    console.log("[wipe] nothing to delete.");
    return;
  }

  const spawnIds = rows.map((r) => r.spawn_id);

  const delClient = await db.connect();
  try {
    await delClient.query("BEGIN");

    const delRes = await delClient.query(
      `
      DELETE FROM spawn_points
      WHERE shard_id = $1
        AND spawn_id = ANY($2::text[])
    `,
      [args.shardId, spawnIds],
    );

    if (args.commit) {
      await delClient.query("COMMIT");
      console.log(`[wipe] committed. deleted=${delRes.rowCount}`);
    } else {
      await delClient.query("ROLLBACK");
      console.log(`[wipe] rolled back (dry-run). would_delete=${delRes.rowCount} (use --commit)`);
    }
  } catch (err) {
    try {
      await delClient.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    delClient.release();
  }
}

// ---------------------------------------------------------------------------
// Trim outposts
// ---------------------------------------------------------------------------

type OutpostParsed = {
  spawnId: string;
  type: string;
  x: number;
  z: number;
  regionId: string | null;
  faction: string;
  index: number;
};

function parseOutpostSpawnId(spawnId: string): { faction: string; index: number } | null {
  const re = /^outpost_(.+)_([0-9]+)_(-?[0-9]+)_(-?[0-9]+)$/;
  const m = re.exec(spawnId);
  if (!m) return null;
  const faction = m[1] || "__unknown__";
  const idx = parseInt(m[2], 10);
  if (!Number.isFinite(idx)) return null;
  return { faction, index: idx };
}

async function runTrimOutposts(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  pad: number;
  maxPerFaction: number;
  artifactDir: string;
  noArtifact: boolean;
  json: boolean;
  commit: boolean;
}): Promise<void> {
  const cellSize = Math.max(1, Math.floor(args.cellSize));
  const pad = Math.max(0, Math.floor(args.pad));
  const maxPerFaction = Math.max(0, Math.floor(args.maxPerFaction));

  const minX = args.bounds.minCx * cellSize - pad;
  const maxX = (args.bounds.maxCx + 1) * cellSize + pad;
  const minZ = args.bounds.minCz * cellSize - pad;
  const maxZ = (args.bounds.maxCz + 1) * cellSize + pad;

  type Row = { spawn_id: string; type: string; x: number; z: number; region_id: string | null };

  const client = await db.connect();
  let rows: Row[] = [];
  try {
    const res = await client.query(
      `
      SELECT spawn_id, type, x, z, region_id
      FROM spawn_points
      WHERE shard_id = $1
        AND type = 'outpost'
        AND x >= $2 AND x <= $3
        AND z >= $4 AND z <= $5
      ORDER BY spawn_id
    `,
      [args.shardId, minX, maxX, minZ, maxZ],
    );

    rows = res.rows as Row[];
  } finally {
    client.release();
  }

  const parsed: OutpostParsed[] = [];
  for (const r of rows) {
    const sid = String(r.spawn_id ?? "");
    const p = parseOutpostSpawnId(sid);
    if (!p) continue;
    parsed.push({
      spawnId: sid,
      type: String(r.type),
      x: Number(r.x),
      z: Number(r.z),
      regionId: r.region_id,
      faction: p.faction,
      index: p.index,
    });
  }

  const byFaction = new Map<string, OutpostParsed[]>();
  for (const o of parsed) {
    const key = o.faction || "__unknown__";
    const arr = byFaction.get(key) ?? [];
    arr.push(o);
    byFaction.set(key, arr);
  }

  const plan: { faction: string; total: number; keep: string[]; delete: string[] }[] = [];
  const toDelete: string[] = [];

  for (const [faction, list] of [...byFaction.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...list].sort((a, b) => a.index - b.index || a.spawnId.localeCompare(b.spawnId));
    const keep = sorted.slice(0, maxPerFaction).map((x) => x.spawnId);
    const del = sorted.slice(maxPerFaction).map((x) => x.spawnId);
    plan.push({ faction, total: sorted.length, keep, delete: del });
    toDelete.push(...del);
  }

  const artifact = {
    kind: "simBrain.trim-outposts",
    version: 1,
    createdAt: new Date().toISOString(),
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize,
    pad,
    maxPerFaction,
    matched: parsed.length,
    plannedDelete: toDelete.length,
    commit: args.commit,
    plan: plan.map((p) => ({
      faction: p.faction,
      total: p.total,
      keepCount: p.keep.length,
      deleteCount: p.delete.length,
      deleteSample: p.delete.slice(0, 20),
    })),
  };

  console.log(
    `[trim] shard=${args.shardId} bounds=${boundsSlug(args.bounds)} cellSize=${cellSize} pad=${pad} maxPerFaction=${maxPerFaction}`,
  );
  console.log(`[trim] outposts_matched=${parsed.length} planned_delete=${toDelete.length} commit=${String(args.commit)}`);

  for (const p of plan) {
    if (p.total <= maxPerFaction) continue;
    console.log(`  - ${p.faction}: total=${p.total} keep=${p.keep.length} delete=${p.delete.length}`);
  }
  if (toDelete.length === 0) console.log("[trim] nothing to delete (already within caps).");

  if (args.json) console.log(JSON.stringify(artifact, null, 2));
  if (!args.noArtifact) {
    const filename = `trim_${isoSlug()}_${args.shardId}_${boundsSlug(args.bounds)}.json`;
    const outPath = await writeArtifactFile(args.artifactDir, filename, artifact);
    console.log(`[trim] artifact=${outPath}`);
  }

  if (toDelete.length === 0) return;

  const delClient = await db.connect();
  try {
    await delClient.query("BEGIN");

    const delRes = await delClient.query(
      `
      DELETE FROM spawn_points
      WHERE shard_id = $1
        AND spawn_id = ANY($2::text[])
    `,
      [args.shardId, toDelete],
    );

    if (args.commit) {
      await delClient.query("COMMIT");
      console.log(`[trim] committed. deleted=${delRes.rowCount}`);
    } else {
      await delClient.query("ROLLBACK");
      console.log(`[trim] rolled back (dry-run). would_delete=${delRes.rowCount} (use --commit)`);
    }
  } catch (err) {
    try {
      await delClient.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    delClient.release();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runSetTownTiersDistanceMode(opts: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  centerX: number;
  centerZ: number;
  minTier: number;
  maxTier: number;
  commit: boolean;
  report: boolean;
}): Promise<void> {
  const minX = opts.bounds.minCx * opts.cellSize;
  const maxX = (opts.bounds.maxCx + 1) * opts.cellSize;
  const minZ = opts.bounds.minCz * opts.cellSize;
  const maxZ = (opts.bounds.maxCz + 1) * opts.cellSize;

  const client = await db.connect();
  let updated = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");

    const res = await client.query(
      `
      SELECT spawn_id, x, z, town_tier
      FROM spawn_points
      WHERE shard_id = $1
        AND type = 'town'
        AND x IS NOT NULL AND z IS NOT NULL
        AND x >= $2 AND x < $3
        AND z >= $4 AND z < $5
      ORDER BY spawn_id
      `,
      [opts.shardId, minX, maxX, minZ, maxZ],
    );

    for (const row of res.rows as Array<{ spawn_id: string; x: number; z: number; town_tier: number | null }>) {
      const spawnId = String(row.spawn_id);
      const x = Number(row.x);
      const z = Number(row.z);

      const desiredTier = tierForPointDistanceMode({
        x,
        z,
        bounds: opts.bounds,
        cellSize: opts.cellSize,
        centerX: opts.centerX,
        centerZ: opts.centerZ,
        minTier: opts.minTier,
        maxTier: opts.maxTier,
      });

      const currentTier = row.town_tier == null ? null : Number(row.town_tier);
      if (currentTier === desiredTier) {
        skipped++;
        continue;
      }

      await client.query(
        `
        UPDATE spawn_points
        SET town_tier = $1
        WHERE shard_id = $2 AND type = 'town' AND spawn_id = $3
        `,
        [desiredTier, opts.shardId, spawnId],
      );

      updated++;

      if (opts.report) {
        console.log(`[set-town-tiers] ${spawnId} (${x.toFixed(2)},${z.toFixed(2)}): ${currentTier ?? "null"} -> ${desiredTier}`);
      }
    }

    if (opts.commit) await client.query("COMMIT");
    else await client.query("ROLLBACK");

    console.log(
      `[set-town-tiers] shard=${opts.shardId} bounds=${opts.bounds.minCx}..${opts.bounds.maxCx},${opts.bounds.minCz}..${opts.bounds.maxCz} mode=distance center=(${opts.centerX},${opts.centerZ}) tiers=${opts.minTier}..${opts.maxTier}`,
    );
    console.log(`[set-town-tiers] ${opts.commit ? "committed" : "dry-run rolled back"}. updated=${updated} skipped=${skipped} ${opts.commit ? "" : "(use --commit)"}`.trim());
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function main(argv: string[]): Promise<void> {
  assertNoEllipsisArgs(argv);

  const cmd = ((argv[0] || "help").toLowerCase() as Cmd) ?? "help";
  const known: Cmd[] = [
    "preview",
    "apply",
    "report",
    "status",
    "town-baseline",
    "set-town-tiers",
    "fill-gaps",
    "era",
    "trim-outposts",
    "snapshot-spawns",
    "restore-spawns",
    "wipe-placements",
    "help",
  ];
  if (!known.includes(cmd)) {
    usage();
    return;
  }

  const commit = hasFlag(argv, "--commit");
  assertCommitHasExplicitBounds(argv, commit);

  const shardId = getFlag(argv, "--shard") ?? "prime_shard";
  const bounds = parseBounds(getFlag(argv, "--bounds") ?? "-4..4,-4..4");
  const cellSize = parseIntFlag(argv, "--cellSize", 64) || 64;

  const updateExisting = hasFlag(argv, "--updateExisting");

  if (cmd === "help") {
    usage();
    return;
  }

  if (cmd === "report") {
    const respawnRadius = parseIntFlag(argv, "--respawnRadius", 500) || 500;
    const top = parseIntFlag(argv, "--top", 25) || 25;
    await runReport({ shardId, bounds, cellSize, respawnRadius, top });
    return;
  }

  if (cmd === "status") {
    const respawnRadius = parseIntFlag(argv, "--respawnRadius", 500) || 500;
    const topGaps = parseIntFlag(argv, "--topGaps", 0) || 0;
    await runStatus({ shardId, bounds, cellSize, respawnRadius, topGaps });
    return;
  }

  if (cmd === "town-baseline") {

    const townTypes = parseTypes(getFlag(argv, "--townTypes"), [
      "town",
      "outpost",
      "hub",
      "village",
      "city",
      "settlement",
      "camp",
    ]);

    const seedMailbox = !hasFlag(argv, "--noMailbox");
    const mailboxProtoId = getFlag(argv, "--mailboxProtoId") ?? "mailbox_basic";
    const mailboxRadius = parseIntFlag(argv, "--mailboxRadius", 8) || 8;

    const seedRest = !hasFlag(argv, "--noRest");
    const restProtoId = getFlag(argv, "--restProtoId") ?? "rest_spot_basic";
    const restRadius = parseIntFlag(argv, "--restRadius", 10) || 10;

const seedStations = !hasFlag(argv, "--noStations");
const stationProtoIds = parseTypes(getFlag(argv, "--stations"), [
  "station_forge",
  "station_alchemy",
  "station_oven",
  "station_mill",
]);
const stationRadius = parseIntFlag(argv, "--stationRadius", 9) || 9;

    const respectTierStations = hasFlag(argv, "--respectTierStations");

    const townTierRaw = getFlag(argv, "--townTier");
    const townTier = townTierRaw != null ? Number(townTierRaw) : null;
    const townTierSafe = Number.isFinite(townTier as number) ? (townTier as number) : null;

const guardCount = parseIntFlag(argv, "--guardCount", 2) || 2;
    const guardProtoId = getFlag(argv, "--guardProtoId") ?? "town_guard";
    const guardRadius = parseIntFlag(argv, "--guardRadius", 12) || 12;

    await runTownBaseline({
      shardId,
      bounds,
      cellSize,
      townTypes,
      seedMailbox,
      mailboxProtoId,
      mailboxRadius,
      seedRest,
      restProtoId,
      restRadius,
seedStations,
stationProtoIds,
stationRadius,
      townTier: townTierSafe,
      respectTierStations,
      guardCount,
      guardProtoId,
      guardRadius,
      commit,
      updateExisting,
    });

    return;
  }

  if (cmd === "set-town-tiers") {
    const boundsRaw = getFlag(argv, "--bounds");
    if (!boundsRaw) throw new Error(`set-town-tiers requires --bounds "min..max,min..max"`);
    const bounds = parseBounds(boundsRaw);

    const cellSize = parseIntFlag(argv, "--cellSize", 64) || 64;

    const mode = (getFlag(argv, "--mode") ?? "distance").toLowerCase();
    if (mode !== "distance") {
      throw new Error(`Unsupported --mode "${mode}". Supported: distance`);
    }

    const minTier = parseIntFlag(argv, "--minTier", 1) || 1;
    const maxTier = parseIntFlag(argv, "--maxTier", 4) || 4;

    const centerRaw = getFlag(argv, "--center") ?? "0,0";
    const [centerX, centerZ] = parseCenter(centerRaw);

    const report = hasFlag(argv, "--report") || hasFlag(argv, "--verbose");

    await runSetTownTiersDistanceMode({
      shardId,
      bounds,
      cellSize,
      centerX,
      centerZ,
      minTier,
      maxTier,
      commit,
      report,
    });
    return;
  }

  if (cmd === "snapshot-spawns") {
    const types = parseTypes(getFlag(argv, "--types"), ["outpost", "checkpoint", "graveyard", "town", "npc"]);
    const pad = parseIntFlag(argv, "--pad", 0) || 0;

    const artifactDir = getFlag(argv, "--artifactDir") ?? "./artifacts/brain";
    const noArtifact = hasFlag(argv, "--noArtifact");
    const json = hasFlag(argv, "--json");

    await runSnapshotSpawns({ shardId, bounds, cellSize, pad, types, artifactDir, noArtifact, json });
    return;
  }

  if (cmd === "restore-spawns") {
    const inFile = getFlag(argv, "--in");
    if (!inFile) throw new Error(`restore-spawns requires --in <snapshot_file.json>`);
    await runRestoreSpawns({ inFile, targetShard: shardId, commit, updateExisting });
    return;
  }

  if (cmd === "wipe-placements") {
    const types = parseTypes(getFlag(argv, "--types"), ["outpost", "checkpoint", "graveyard"]);
    const pad = parseIntFlag(argv, "--pad", 0) || 0;

    const artifactDir = getFlag(argv, "--artifactDir") ?? "./artifacts/brain";
    const noArtifact = hasFlag(argv, "--noArtifact");
    const json = hasFlag(argv, "--json");

    await runWipePlacements({ shardId, bounds, cellSize, pad, types, artifactDir, noArtifact, json, commit });
    return;
  }

  if (cmd === "trim-outposts") {
    const maxPerFactionRaw = getFlag(argv, "--maxPerFaction");
    if (!maxPerFactionRaw) throw new Error(`trim-outposts requires --maxPerFaction N`);
    const maxPerFaction = Math.max(0, parseInt(maxPerFactionRaw, 10) || 0);

    const pad = parseIntFlag(argv, "--pad", 0) || 0;
    const artifactDir = getFlag(argv, "--artifactDir") ?? "./artifacts/brain";
    const noArtifact = hasFlag(argv, "--noArtifact");
    const json = hasFlag(argv, "--json");

    await runTrimOutposts({ shardId, bounds, cellSize, pad, maxPerFaction, artifactDir, noArtifact, json, commit });
    return;
  }

  if (cmd === "fill-gaps") {
    const seed = getFlag(argv, "--seed") ?? "seed:gapfill";
    const respawnRadius = parseIntFlag(argv, "--respawnRadius", 500) || 500;
    const minDistance = parseIntFlag(argv, "--minDistance", 300) || 300;
    const maxPlace = parseIntFlag(argv, "--maxPlace", 50) || 50;

    const spawnTypeRaw = (getFlag(argv, "--spawnType") ?? "checkpoint").toLowerCase();
    const spawnType = (spawnTypeRaw === "graveyard" ? "graveyard" : "checkpoint") as "checkpoint" | "graveyard";

    const protoId = getFlag(argv, "--protoId") ?? spawnType;
    const archetype = getFlag(argv, "--archetype") ?? spawnType;
    const borderMargin = parseIntFlag(argv, "--borderMargin", 16) || 16;
    const json = hasFlag(argv, "--json");

    await runFillGaps({
      shardId,
      bounds,
      cellSize,
      seed,
      respawnRadius,
      minDistance,
      maxPlace,
      spawnType,
      protoId,
      archetype,
      borderMargin,
      json,
      commit,
      updateExisting,
    });
    return;
  }

  // planner shared args (preview/apply/era)
  const seed = getFlag(argv, "--seed") ?? "seed:alpha";
  const borderMargin = parseIntFlag(argv, "--borderMargin", 16) || 16;
  const minCellDistance = parseIntFlag(argv, "--minCellDistance", 3) || 3;

  const spawnType = getFlag(argv, "--spawnType") ?? "outpost";
  const protoId = getFlag(argv, "--protoId") ?? "outpost";
  const archetype = getFlag(argv, "--archetype") ?? "outpost";

  const requestedFactions = parseFactions(getFlag(argv, "--factions") ?? "emberfall:2,oathbound:2");

  const factionsAreTotal = hasFlag(argv, "--factionsAreTotal");
  const appendFlag = hasFlag(argv, "--append");
  const maxOutpostsRaw = getFlag(argv, "--maxOutpostsPerFaction");
  const maxOutpostsPerFaction = maxOutpostsRaw == null ? null : Math.max(0, parseInt(maxOutpostsRaw, 10) || 0);

  const append = appendFlag || factionsAreTotal || maxOutpostsPerFaction != null;

  const existingStats = append ? await loadExistingOutpostStats(shardId) : null;
  const factions = clampOutpostPlan({
    requested: requestedFactions,
    factionsAreTotal,
    maxOutpostsPerFaction,
    append,
    existing: existingStats,
  });

  if (append) {
    const want = requestedFactions.map((f) => `${f.factionId}:${f.count}`).join(",") || "(none)";
    const eff = factions.map((f) => `${f.factionId}:${f.count}@${f.startIndex ?? 0}`).join(",") || "(none)";
    console.log(
      `[planner] safeMode=on factionsAreTotal=${String(factionsAreTotal)} maxOutpostsPerFaction=${
        maxOutpostsPerFaction == null ? "∞" : String(maxOutpostsPerFaction)
      }`,
    );
    console.log(`[planner] requested=${want}`);
    console.log(`[planner] effective=${eff}`);
  }

  const cfg: SettlementPlanConfig = {
    seed,
    shardId,
    bounds,
    cellSize,
    baseY: 0,
    borderMargin,
    minCellDistance,
    spawnType,
    protoId,
    archetype,
  };

  const outpostActions = planInitialOutposts(factions, cfg) as unknown as BrainAction[];

  if (cmd === "preview") {
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(outpostActions, null, 2));
      return;
    }

    console.log(`[simBrain] actions=${outpostActions.length} seed=${seed} shard=${shardId}`);
    for (const a of outpostActions) {
      if ((a as PlaceSpawnAction).kind !== "place_spawn") continue;
      const s = (a as PlaceSpawnAction).spawn;
      console.log(
        `- ${s.spawnId} type=${s.type} proto=${s.protoId} @ (${s.x.toFixed(2)},${s.z.toFixed(2)}) region=${s.regionId}`,
      );
    }
    return;
  }

  if (cmd === "apply") {
    const res = await applyToDb(outpostActions, { commit, updateExisting });
    if (commit) {
      console.log(`[simBrain] committed.\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped}`);
    } else {
      console.log(
        `[simBrain] rolled back (dry-run).\ninserted=${res.inserted} updated=${res.updated} skipped=${res.skipped} (use --commit)`,
      );
    }
    return;
  }

  // cmd === era
  const respawnRadius = parseIntFlag(argv, "--respawnRadius", 500) || 500;
  const gapSeed = getFlag(argv, "--gapSeed") ?? "seed:gapfill";
  const minDistance = parseIntFlag(argv, "--minDistance", 300) || 300;
  const maxPlace = parseIntFlag(argv, "--maxPlace", 50) || 50;

  const gapSpawnTypeRaw = (getFlag(argv, "--gapSpawnType") ?? "checkpoint").toLowerCase();
  const gapSpawnType = (gapSpawnTypeRaw === "graveyard" ? "graveyard" : "checkpoint") as "checkpoint" | "graveyard";
  const gapProtoId = getFlag(argv, "--gapProtoId") ?? gapSpawnType;
  const gapArchetype = getFlag(argv, "--gapArchetype") ?? gapSpawnType;
  const gapBorderMargin = parseIntFlag(argv, "--gapBorderMargin", borderMargin) || borderMargin;

  const artifactDir = getFlag(argv, "--artifactDir") ?? "./artifacts/brain";
  const noArtifact = hasFlag(argv, "--noArtifact");
  const json = hasFlag(argv, "--json");

  await runEra({
    shardId,
    bounds,
    cellSize,

    seed,
    borderMargin,
    minCellDistance,
    spawnType,
    protoId,
    archetype,

    requestedFactions,
    factionsAreTotal,
    appendFlag,
    maxOutpostsPerFaction,

    respawnRadius,
    gapSeed,
    minDistance,
    maxPlace,
    gapSpawnType,
    gapProtoId,
    gapArchetype,
    gapBorderMargin,

    artifactDir,
    noArtifact,
    json,

    commit,
    updateExisting,
  });
}

void (async () => {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await db.end().catch(() => {});
  }
})();