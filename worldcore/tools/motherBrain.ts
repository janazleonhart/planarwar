// worldcore/tools/motherBrain.ts
/* eslint-disable no-console */

/**
 * Mother Brain (v0) — spawn_points DB writer + status reporting.
 *
 * IMPORTANT:
 * - This file MUST be safe to import in unit tests.
 * - Do NOT import Database / open sockets at module load time.
 * - Do NOT auto-run main() when imported.
 */

import { planBrainWave } from "../sim/MotherBrainWavePlanner";
import { createHash } from "crypto";
import type {
  Bounds,
  BrainWaveTheme,
  PlaceSpawnAction,
} from "../sim/MotherBrainWavePlanner";

// ---------------------------------------------------------------------------
// Test/runtime guards
// ---------------------------------------------------------------------------

function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

async function getDb(): Promise<any> {
  // Lazy import: Database.ts may create a pool that keeps node --test alive.
  const mod = await import("../db/Database");
  return mod.db;
}

// ---------------------------------------------------------------------------
// Public helpers (testable)
// ---------------------------------------------------------------------------

export type BrainSpawnIdInfo = {
  raw: string;
  parts: string[];
  theme: BrainWaveTheme | null;
  epoch: number | null;
};

/**
 * Best-effort spawn_id parser.
 *
 * We don't assume an exact schema because the spawnId format is allowed
 * to evolve. We do a conservative extraction:
 * - theme: first known theme token we see
 * - epoch: first integer token we see (0..)
 */
export function parseBrainSpawnId(spawnId: string): BrainSpawnIdInfo {
  const raw = String(spawnId ?? "");
  const parts = raw.split(":").map((s) => s.trim()).filter(Boolean);

  let theme: BrainWaveTheme | null = null;
  let epoch: number | null = null;

  for (const p of parts) {
    const t = normalizeTheme(p);
    if (theme == null && t != null) theme = t;

    if (epoch == null) {
      const n = parseInt(p, 10);
      if (Number.isFinite(n) && String(n) === p.replace(/^\+/, "")) {
        if (n >= 0) epoch = n;
      }
    }

    if (theme != null && epoch != null) break;
  }

  return { raw, parts, theme, epoch };
}

export type BrainSpawnRow = {
  spawnId: string;
  type: string;
  archetype: string;
  protoId: string | null;
  variantId: string | null;
  regionId: string | null;
  x: number | null;
  z: number | null;
};

export type BrainSpawnSummary = {
  total: number;
  byTheme: Record<string, number>;
  byEpoch: Record<string, number>;
  byType: Record<string, number>;
  byProtoId: Record<string, number>;
};

export function summarizeBrainSpawns(rows: BrainSpawnRow[]): BrainSpawnSummary {
  const byTheme: Record<string, number> = {};
  const byEpoch: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byProtoId: Record<string, number> = {};

  for (const r of rows) {
    const info = parseBrainSpawnId(r.spawnId);

    const themeKey = info.theme ?? "unknown";
    byTheme[themeKey] = (byTheme[themeKey] ?? 0) + 1;

    const epochKey = info.epoch == null ? "unknown" : String(info.epoch);
    byEpoch[epochKey] = (byEpoch[epochKey] ?? 0) + 1;

    const typeKey = String(r.type ?? "unknown");
    byType[typeKey] = (byType[typeKey] ?? 0) + 1;

    const protoKey = String(r.protoId ?? "(null)");
    byProtoId[protoKey] = (byProtoId[protoKey] ?? 0) + 1;
  }

  return {
    total: rows.length,
    byTheme,
    byEpoch,
    byType,
    byProtoId,
  };
}

// ---------------------------------------------------------------------------
// CLI utils
// ---------------------------------------------------------------------------

function usage(): void {
  console.log(
    `
Planar War — Mother Brain (v0) spawn writer

Usage:
  node dist/worldcore/tools/motherBrain.js wave [options] [--commit]
  node dist/worldcore/tools/motherBrain.js status [options]

Commands:
  wave    Plan and apply a deterministic "wave" of brain:* spawn_points
  status  Summarize existing brain:* spawn_points (counts by theme/epoch/type/proto)

Common options:
  --shard         shard id (default: prime_shard)
  --bounds        cell bounds (default: -1..1,-1..1) e.g. -1..1,-1..1
  --cellSize      cell size in world units (default: 64)

Wave options:
  --borderMargin  in-cell margin (default: 16)
  --seed          deterministic seed (default: seed:mother)
  --epoch         integer epoch/tick (default: 0)
  --theme         goblins|bandits|rats|ore (default: goblins)
  --count         number of placements (default: 8)

Wave safety:
  --commit        actually write to DB (default: dry-run / rollback)
  --confirm <token> required when --commit would delete rows (printed on dry-run)
  --append        do NOT delete existing brain:* spawns in bounds (default: false)

Status options:
  --theme         filter by theme token (goblins|bandits|rats|ore)
  --epoch         filter by integer epoch token (e.g. 0)
  --list          print each spawn_id (limited)
  --limit         list limit (default: 50)
  --json          emit JSON summary

What wave does:
  - Deletes ONLY brain:* spawn_ids within the bounds box (unless --append)
  - Inserts new brain:* spawn points for the chosen epoch/theme

Notes:
  - This is a DB-writing TOOL (like simBrain), not the long-running Mother Brain service.
  - When Mother Brain becomes its own process, this logic will be extracted into her directory.
`.trim(),
  );
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function getFlag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) return null;
  return v;
}

function parseIntFlag(argv: string[], name: string, fallback: number): number {
  const raw = getFlag(argv, name);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}


function hashToken(input: unknown): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return createHash("sha256").update(s).digest("hex").slice(0, 10);
}

function makeConfirmToken(prefix: "REPLACE", shardId: string, scope: unknown): string {
  return `${prefix}:${shardId}:${hashToken(scope)}`;
}

function parseBounds(input: string): Bounds {
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  const a = parts[0] ?? "0..0";
  const b = parts[1] ?? "0..0";
  const [minCx, maxCx] = parseRange(a);
  const [minCz, maxCz] = parseRange(b);
  return { minCx, maxCx, minCz, maxCz };
}

function parseRange(s: string): [number, number] {
  const [loRaw, hiRaw] = s.split("..").map((x) => x.trim());
  const lo = parseInt(loRaw || "0", 10);
  const hi = parseInt((hiRaw ?? loRaw ?? "0") || "0", 10);
  const a = Number.isFinite(lo) ? lo : 0;
  const b = Number.isFinite(hi) ? hi : a;
  return [Math.min(a, b), Math.max(a, b)];
}

function assertCommitHasExplicitBounds(argv: string[], commit: boolean): void {
  if (!commit) return;
  if (!hasFlag(argv, "--bounds")) {
    throw new Error(`Refusing to --commit without explicit --bounds.`);
  }
}

function boundsToWorldBox(
  bounds: Bounds,
  cellSize: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const cs = Math.max(1, Math.floor(cellSize));
  return {
    minX: bounds.minCx * cs,
    maxX: (bounds.maxCx + 1) * cs,
    minZ: bounds.minCz * cs,
    maxZ: (bounds.maxCz + 1) * cs,
  };
}

function normalizeTheme(raw: string | null): BrainWaveTheme | null {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "goblins" || t === "bandits" || t === "rats" || t === "ore") return t;
  return null;
}

// ---------------------------------------------------------------------------
// DB access
// ---------------------------------------------------------------------------

async function loadBrainSpawnIdsInBox(args: {
  shardId: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}): Promise<string[]> {
  const db = await getDb();
  const client = await db.connect();
  try {
    const res = await client.query(
      `
      SELECT spawn_id
      FROM spawn_points
      WHERE shard_id = $1
        AND spawn_id LIKE 'brain:%'
        AND x IS NOT NULL AND z IS NOT NULL
        AND x >= $2 AND x <= $3
        AND z >= $4 AND z <= $5
      ORDER BY spawn_id
    `,
      [args.shardId, args.minX, args.maxX, args.minZ, args.maxZ],
    );

    return (res.rows as Array<{ spawn_id: string }>).map((r) => r.spawn_id);
  } finally {
    client.release();
  }
}

async function loadBrainSpawnsInBox(args: {
  shardId: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  theme: BrainWaveTheme | null;
  epoch: number | null;
}): Promise<BrainSpawnRow[]> {
  const db = await getDb();
  const client = await db.connect();
  try {
    const res = await client.query(
      `
      SELECT spawn_id, type, archetype, proto_id, variant_id, region_id, x, z
      FROM spawn_points
      WHERE shard_id = $1
        AND spawn_id LIKE 'brain:%'
        AND x IS NOT NULL AND z IS NOT NULL
        AND x >= $2 AND x <= $3
        AND z >= $4 AND z <= $5
      ORDER BY spawn_id
    `,
      [args.shardId, args.minX, args.maxX, args.minZ, args.maxZ],
    );

    const rows = (res.rows as Array<any>).map((r) => {
      const row: BrainSpawnRow = {
        spawnId: String(r.spawn_id),
        type: String(r.type ?? ""),
        archetype: String(r.archetype ?? ""),
        protoId: (r.proto_id ?? null) as string | null,
        variantId: (r.variant_id ?? null) as string | null,
        regionId: (r.region_id ?? null) as string | null,
        x: (r.x ?? null) as number | null,
        z: (r.z ?? null) as number | null,
      };
      return row;
    });

    // Apply filters in-memory because spawnId format can evolve.
    const filtered = rows.filter((r) => {
      const info = parseBrainSpawnId(r.spawnId);
      if (args.theme != null && info.theme !== args.theme) return false;
      if (args.epoch != null && info.epoch !== args.epoch) return false;
      return true;
    });

    return filtered;
  } finally {
    client.release();
  }
}

async function upsertActions(
  client: any,
  actions: PlaceSpawnAction[],
  opts: { updateExisting: boolean },
): Promise<number> {
  let inserted = 0;

  for (const a of actions) {
    if (!a || a.kind !== "place_spawn") continue;
    const s = a.spawn;

    const existing = await client.query(
      `SELECT id FROM spawn_points WHERE shard_id = $1 AND spawn_id = $2 LIMIT 1`,
      [s.shardId, s.spawnId],
    );

    if (existing.rowCount && existing.rows[0]) {
      if (!opts.updateExisting) continue;

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

  return inserted;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function applyWaveToDb(args: {
  commit: boolean;
  append: boolean;
  confirm: string | null | undefined;
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  borderMargin: number;
  seed: string;
  epoch: number;
  theme: BrainWaveTheme;
  count: number;
}): Promise<void> {
  const box = boundsToWorldBox(args.bounds, args.cellSize);

  const planned = planBrainWave({
    shardId: args.shardId,
    bounds: args.bounds,
    cellSize: args.cellSize,
    borderMargin: args.borderMargin,
    seed: args.seed,
    epoch: args.epoch,
    theme: args.theme,
    count: args.count,
  });

  const brainSpawnIds = args.append
    ? []
    : await loadBrainSpawnIdsInBox({ shardId: args.shardId, ...box });


const expectedConfirmToken =
  !args.append && brainSpawnIds.length > 0
    ? makeConfirmToken("REPLACE", args.shardId, {
        bounds: args.bounds,
        cellSize: args.cellSize,
        borderMargin: args.borderMargin,
        deleteScope: "brain:* in selection box",
      })
    : null;

if (args.commit && expectedConfirmToken) {
  const confirm = String(args.confirm ?? "").trim();
  if (confirm !== expectedConfirmToken) {
    console.error(
      `[motherBrain] REFUSING commit: would_delete=${brainSpawnIds.length}. Re-run with --confirm ${expectedConfirmToken}`,
    );
    return;
  }
}


  console.log(
    `[motherBrain] shard=${args.shardId} bounds=${args.bounds.minCx}..${args.bounds.maxCx},${args.bounds.minCz}..${args.bounds.maxCz} cellSize=${args.cellSize} epoch=${args.epoch} theme=${args.theme} count=${args.count}`,
  );
  console.log(
    `[motherBrain] planned=${planned.length} delete_existing_brain=${brainSpawnIds.length} commit=${String(args.commit)} append=${String(args.append)}`,
  );

  if (!args.commit && expectedConfirmToken) {
    console.log(`[motherBrain] confirm_token=${expectedConfirmToken} (required for --commit when deletions > 0)`);
  }

  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (!args.append && brainSpawnIds.length > 0) {
      await client.query(
        `
        DELETE FROM spawn_points
        WHERE shard_id = $1
          AND spawn_id = ANY($2::text[])
      `,
        [args.shardId, brainSpawnIds],
      );
    }

    const inserted = await upsertActions(client, planned, { updateExisting: false });

    if (args.commit) {
      await client.query("COMMIT");
      console.log(`[motherBrain] committed. inserted=${inserted} deleted=${brainSpawnIds.length}`);
    } else {
      await client.query("ROLLBACK");
      console.log(
        `[motherBrain] rolled back (dry-run). would_insert=${inserted} would_delete=${brainSpawnIds.length} (use --commit)`,
      );
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function statusBrainSpawns(args: {
  shardId: string;
  bounds: Bounds;
  cellSize: number;
  theme: BrainWaveTheme | null;
  epoch: number | null;
  list: boolean;
  limit: number;
  json: boolean;
}): Promise<void> {
  if (isNodeTestRuntime()) {
    // No DB access in tests.
    const empty = summarizeBrainSpawns([]);
    if (args.json) {
      process.stdout.write(JSON.stringify(empty, null, 2) + "\n");
    } else {
      console.log("[motherBrain] status skipped in test runtime");
    }
    return;
  }

  const box = boundsToWorldBox(args.bounds, args.cellSize);
  const rows = await loadBrainSpawnsInBox({ shardId: args.shardId, ...box, theme: args.theme, epoch: args.epoch });
  const summary = summarizeBrainSpawns(rows);

  if (args.json) {
    process.stdout.write(JSON.stringify({
      shardId: args.shardId,
      bounds: args.bounds,
      cellSize: args.cellSize,
      worldBox: box,
      filters: { theme: args.theme, epoch: args.epoch },
      summary,
    }, null, 2) + "\n");
    return;
  }

  const themeStr = args.theme ?? "(any)";
  const epochStr = args.epoch == null ? "(any)" : String(args.epoch);

  console.log(
    `[motherBrain] status shard=${args.shardId} bounds=${args.bounds.minCx}..${args.bounds.maxCx},${args.bounds.minCz}..${args.bounds.maxCz} cellSize=${args.cellSize} theme=${themeStr} epoch=${epochStr}`,
  );
  console.log(
    `[motherBrain] total=${summary.total} box_x=${box.minX}..${box.maxX} box_z=${box.minZ}..${box.maxZ}`,
  );

  const printCounts = (label: string, rec: Record<string, number>): void => {
    const keys = Object.keys(rec).sort((a, b) => (rec[b] ?? 0) - (rec[a] ?? 0));
    const parts = keys.map((k) => `${k}=${rec[k]}`);
    console.log(`[motherBrain] ${label}: ${parts.length ? parts.join(" ") : "(none)"}`);
  };

  printCounts("byTheme", summary.byTheme);
  printCounts("byEpoch", summary.byEpoch);
  printCounts("byType", summary.byType);

  // protoId list is often long; print top 8.
  const protoKeys = Object.keys(summary.byProtoId).sort(
    (a, b) => (summary.byProtoId[b] ?? 0) - (summary.byProtoId[a] ?? 0),
  );
  const topProto = protoKeys.slice(0, 8).map((k) => `${k}=${summary.byProtoId[k]}`);
  console.log(`[motherBrain] topProto: ${topProto.length ? topProto.join(" ") : "(none)"}`);

  if (args.list) {
    const lim = Math.max(1, Math.min(args.limit, 500));
    console.log(`[motherBrain] list (limit=${lim}):`);
    for (const r of rows.slice(0, lim)) {
      console.log(
        `- ${r.spawnId} type=${r.type} proto=${r.protoId ?? "(null)"} region=${r.regionId ?? "(null)"}`,
      );
    }
    if (rows.length > lim) {
      console.log(`[motherBrain] (truncated) remaining=${rows.length - lim}`);
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmdRaw = String(argv[0] ?? "help").trim().toLowerCase();

  if (cmdRaw === "help" || cmdRaw === "--help" || cmdRaw === "-h") {
    usage();
    return;
  }

  if (cmdRaw !== "wave" && cmdRaw !== "status") {
    usage();
    process.exitCode = 1;
    return;
  }

  const shardId = getFlag(argv, "--shard") ?? "prime_shard";
  const boundsRaw = getFlag(argv, "--bounds") ?? "-1..1,-1..1";
  const bounds = parseBounds(boundsRaw);
  const cellSize = parseIntFlag(argv, "--cellSize", 64);

  if (cmdRaw === "status") {
    const theme = normalizeTheme(getFlag(argv, "--theme"));

    // epoch filter: only active if flag is present
    const epoch = hasFlag(argv, "--epoch")
      ? parseIntFlag(argv, "--epoch", 0)
      : null;

    const list = hasFlag(argv, "--list");
    const limit = parseIntFlag(argv, "--limit", 50);
    const json = hasFlag(argv, "--json");

    await statusBrainSpawns({
      shardId,
      bounds,
      cellSize,
      theme,
      epoch,
      list,
      limit,
      json,
    });

    return;
  }

  // cmdRaw === "wave"
  const commit = hasFlag(argv, "--commit");
  assertCommitHasExplicitBounds(argv, commit);

  const borderMargin = parseIntFlag(argv, "--borderMargin", 16);

  const seed = getFlag(argv, "--seed") ?? "seed:mother";
  const epoch = parseIntFlag(argv, "--epoch", 0);

  const theme = normalizeTheme(getFlag(argv, "--theme")) ?? "goblins";
  const count = parseIntFlag(argv, "--count", 8);

  const append = hasFlag(argv, "--append");
  const confirm = getFlag(argv, "--confirm");

  await applyWaveToDb({
    commit,
    append,
    confirm,
    shardId,
    bounds,
    cellSize,
    borderMargin,
    seed,
    epoch,
    theme,
    count,
  });
}

// Guard: do not auto-run when imported by unit tests.
// This file is compiled as CJS; require/module exist at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const module: any;

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error("[motherBrain] failed", err);
    process.exitCode = 1;
  });
}
