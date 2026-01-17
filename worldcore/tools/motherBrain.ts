// worldcore/tools/motherBrain.ts
/* eslint-disable no-console */

import { db } from "../db/Database";
import { planBrainWave } from "../sim/MotherBrainWavePlanner";
import type { Bounds, BrainWaveTheme, PlaceSpawnAction } from "../sim/MotherBrainWavePlanner";

function usage(): void {
  console.log(
    `
Planar War — Mother Brain (v0) spawn writer

Usage:
  node dist/worldcore/tools/motherBrain.js wave [options] [--commit]

Options:
  --shard         shard id (default: prime_shard)
  --bounds        cell bounds (required for --commit) e.g. -1..1,-1..1
  --cellSize      cell size in world units (default: 64)
  --borderMargin  in-cell margin (default: 16)

  --seed          deterministic seed (default: seed:mother)
  --epoch         integer epoch/tick (default: 0)
  --theme         goblins|bandits|rats|ore (default: goblins)
  --count         number of placements (default: 8)

Safety:
  --commit        actually write to DB (default: dry-run / rollback)
  --append        do NOT delete existing brain:* spawns in bounds (default: false)

What it does:
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

async function loadBrainSpawnIdsInBox(args: {
  shardId: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}): Promise<string[]> {
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

async function applyWaveToDb(args: {
  commit: boolean;
  append: boolean;
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

  console.log(
    `[motherBrain] shard=${args.shardId} bounds=${args.bounds.minCx}..${args.bounds.maxCx},${args.bounds.minCz}..${args.bounds.maxCz} cellSize=${args.cellSize} epoch=${args.epoch} theme=${args.theme} count=${args.count}`,
  );
  console.log(
    `[motherBrain] planned=${planned.length} delete_existing_brain=${brainSpawnIds.length} commit=${String(args.commit)} append=${String(args.append)}`,
  );

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

function normalizeTheme(raw: string | null): BrainWaveTheme {
  const t = String(raw ?? "goblins").trim().toLowerCase();
  if (t === "goblins" || t === "bandits" || t === "rats" || t === "ore") return t;
  return "goblins";
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

  if (cmdRaw !== "wave") {
    usage();
    process.exitCode = 1;
    return;
  }

  const commit = hasFlag(argv, "--commit");
  assertCommitHasExplicitBounds(argv, commit);

  const shardId = getFlag(argv, "--shard") ?? "prime_shard";
  const boundsRaw = getFlag(argv, "--bounds") ?? "-1..1,-1..1";
  const bounds = parseBounds(boundsRaw);

  const cellSize = parseIntFlag(argv, "--cellSize", 64);
  const borderMargin = parseIntFlag(argv, "--borderMargin", 16);

  const seed = getFlag(argv, "--seed") ?? "seed:mother";
  const epoch = parseIntFlag(argv, "--epoch", 0);

  const theme = normalizeTheme(getFlag(argv, "--theme"));
  const count = parseIntFlag(argv, "--count", 8);

  const append = hasFlag(argv, "--append");

  await applyWaveToDb({
    commit,
    append,
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

main().catch((err) => {
  console.error("[motherBrain] failed", err);
  process.exitCode = 1;
});
