// worldcore/tools/simBrain.ts
/* eslint-disable no-console */

import { db } from "../db/Database";

import { planInitialOutposts } from "../sim/SettlementPlanner";
import type { FactionSeedSpec, SettlementPlanConfig } from "../sim/SettlementPlanner";
import type { Bounds } from "../sim/SimGrid";

import { computeRespawnCoverage } from "../sim/RespawnCoverage";
import type { SpawnForCoverage } from "../sim/RespawnCoverage";

import { planGapFillSpawns } from "../sim/GapFiller";
import type { GapFillPlanConfig } from "../sim/GapFiller";

type Cmd = "preview" | "apply" | "report" | "fill-gaps" | "help";

function usage(): void {
  console.log(`
Planar War — Dev Simulation Harness (WorldCore)

Usage:
  node dist/worldcore/tools/simBrain.js preview   [options]
  node dist/worldcore/tools/simBrain.js apply     [options] [--commit]
  node dist/worldcore/tools/simBrain.js report    [options]
  node dist/worldcore/tools/simBrain.js fill-gaps [options] [--commit]

Common options:
  --shard <shardId>             shard id (default: prime_shard)
  --bounds <cx..cx,cz..cz>      cell bounds (default: -4..4,-4..4)
  --cellSize <n>                cell size in world units (default: 64)

Planner options (preview/apply):
  --seed <seed>                 deterministic seed (default: seed:alpha)
  --minCellDistance <n>         spacing in CELLS (default: 3)
  --borderMargin <n>            in-cell border margin (default: 16)
  --factions <list>             e.g. emberfall:2,oathbound:3
  --spawnType <type>            default: outpost
  --protoId <protoId>           default: outpost
  --archetype <archetype>       default: outpost
  --commit                      apply only: commit to DB (otherwise rollback)
  --json                        preview only: print JSON actions

Report options:
  --respawnRadius <n>           world units radius for "covered" (default: 500)
  --top <n>                     show worst N gaps (default: 25)

Fill-gaps options:
  --seed <seed>                 deterministic seed (default: seed:gapfill)
  --respawnRadius <n>           coverage radius (default: 500)
  --minDistance <n>             min distance between checkpoints/graveyards (default: 300)
  --maxPlace <n>                max new spawns to place (default: 50)
  --spawnType <checkpoint|graveyard>  default: checkpoint
  --protoId <protoId>           default: checkpoint
  --archetype <archetype>       default: checkpoint
  --borderMargin <n>            in-cell border margin (default: 16)
  --commit                      fill-gaps only: commit to DB (otherwise rollback)
  --json                        print planned actions as JSON

Examples:
  node dist/worldcore/tools/simBrain.js preview --seed seed:alpha --bounds -4..4,-4..4 --factions emberfall:2,oathbound:2
  node dist/worldcore/tools/simBrain.js apply   --seed seed:alpha --bounds -4..4,-4..4 --factions emberfall:2,oathbound:2 --commit
  node dist/worldcore/tools/simBrain.js report  --bounds -8..8,-8..8 --respawnRadius 500 --top 25
  node dist/worldcore/tools/simBrain.js fill-gaps --bounds -8..8,-8..8 --respawnRadius 500 --minDistance 300 --maxPlace 50
  node dist/worldcore/tools/simBrain.js fill-gaps --bounds -8..8,-8..8 --respawnRadius 500 --commit
`.trim());
}

function getFlag(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  const v = argv[idx + 1];
  if (!v || v.startsWith("--")) return null;
  return v;
}

function hasFlag(argv: string[], name: boolean | string): boolean {
  if (typeof name === "boolean") return name;
  return (process.argv.slice(2) ?? []).includes(name);
}

function parseBounds(input: string): Bounds {
  const [a, b] = input.split(",").map((s) => s.trim());
  const [minCx, maxCx] = parseRange(a);
  const [minCz, maxCz] = parseRange(b);
  return { minCx, maxCx, minCz, maxCz };
}

function parseRange(s: string): [number, number] {
  const [loRaw, hiRaw] = s.split("..").map((x) => x.trim());
  const lo = parseInt(loRaw || "0", 10);
  const hi = parseInt(hiRaw ?? loRaw ?? "0", 10);
  const a = Number.isFinite(lo) ? lo : 0;
  const b = Number.isFinite(hi) ? hi : a;
  return [Math.min(a, b), Math.max(a, b)];
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

async function applyToDb(actions: any[], commit: boolean): Promise<void> {
  const client = await db.connect();
  let inserted = 0;
  let updated = 0;

  try {
    await client.query("BEGIN");

    for (const a of actions) {
      if (a.kind !== "place_spawn") continue;
      const s = a.spawn;

      const existing = await client.query(
        `SELECT id FROM spawn_points WHERE shard_id = $1 AND spawn_id = $2 LIMIT 1`,
        [s.shardId, s.spawnId],
      );

      if (existing.rowCount && existing.rows[0]) {
        const id = (existing.rows[0] as any).id as number;

        await client.query(
          `
          UPDATE spawn_points
          SET type = $2,
              archetype = $3,
              proto_id = $4,
              variant_id = $5,
              x = $6,
              y = $7,
              z = $8,
              region_id = $9
          WHERE id = $1
          `,
          [id, s.type, s.archetype, s.protoId, s.variantId, s.x, s.y, s.z, s.regionId],
        );

        updated++;
      } else {
        await client.query(
          `
          INSERT INTO spawn_points
            (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [s.shardId, s.spawnId, s.type, s.archetype, s.protoId, s.variantId, s.x, s.y, s.z, s.regionId],
        );

        inserted++;
      }
    }

    if (commit) {
      await client.query("COMMIT");
      console.log(`[simBrain] committed. inserted=${inserted} updated=${updated}`);
    } else {
      await client.query("ROLLBACK");
      console.log(`[simBrain] rolled back (dry-run). inserted=${inserted} updated=${updated} (use --commit)`);
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

  const client = await db.connect();
  try {
    const res = await client.query(
      `
      SELECT spawn_id, type, x, z, variant_id
      FROM spawn_points
      WHERE shard_id = $1
        AND x >= $2 AND x <= $3
        AND z >= $4 AND z <= $5
      `,
      [args.shardId, minX, maxX, minZ, maxZ],
    );

    return res.rows.map((r: any) => ({
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

  const { rows, summary } = computeRespawnCoverage(spawns, {
    bounds: args.bounds,
    cellSize,
    respawnRadius: radius,
  });

  console.log(
    `[report] shard=${args.shardId} bounds=${args.bounds.minCx}..${args.bounds.maxCx},${args.bounds.minCz}..${args.bounds.maxCz} ` +
      `cellSize=${cellSize} radius=${radius} spawns_scanned=${spawns.length}`,
  );
  console.log(
    `[report] cells=${summary.totalCells} covered=${summary.coveredCells} gaps=${summary.gapCells} coverage=${summary.coveragePct.toFixed(2)}%`,
  );

  const gaps = rows
    .filter((r) => !r.covered)
    .sort((a, b) => b.nearestDistance - a.nearestDistance);

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

  const actions = planned.map((p) => ({
    kind: "place_spawn",
    spawn: p,
  }));

  if (args.json) {
    console.log(JSON.stringify(actions, null, 2));
  } else {
    console.log(
      `[fill-gaps] planned=${planned.length} seed=${args.seed} shard=${args.shardId} radius=${args.respawnRadius} minDist=${args.minDistance} maxPlace=${args.maxPlace}`,
    );
    for (const p of planned) {
      console.log(`- ${p.spawnId} type=${p.type} @ (${p.x.toFixed(2)},${p.z.toFixed(2)}) region=${p.regionId}`);
    }
  }

  if (planned.length === 0) {
    console.log("[fill-gaps] nothing to place.");
    return;
  }

  await applyToDb(actions as any[], args.commit);
}

async function main(argv: string[]): Promise<void> {
  const cmd = ((argv[0] || "help").toLowerCase() as Cmd) ?? "help";
  if (cmd !== "preview" && cmd !== "apply" && cmd !== "report" && cmd !== "fill-gaps") {
    usage();
    return;
  }

  const shardId = getFlag(argv, "--shard") ?? "prime_shard";
  const bounds = parseBounds(getFlag(argv, "--bounds") ?? "-4..4,-4..4");
  const cellSize = parseInt(getFlag(argv, "--cellSize") ?? "64", 10) || 64;

  if (cmd === "report") {
    const respawnRadius = parseInt(getFlag(argv, "--respawnRadius") ?? "500", 10) || 500;
    const top = parseInt(getFlag(argv, "--top") ?? "25", 10) || 25;
    await runReport({ shardId, bounds, cellSize, respawnRadius, top });
    return;
  }

  if (cmd === "fill-gaps") {
    const seed = getFlag(argv, "--seed") ?? "seed:gapfill";
    const respawnRadius = parseInt(getFlag(argv, "--respawnRadius") ?? "500", 10) || 500;
    const minDistance = parseInt(getFlag(argv, "--minDistance") ?? "300", 10) || 300;
    const maxPlace = parseInt(getFlag(argv, "--maxPlace") ?? "50", 10) || 50;

    const spawnTypeRaw = (getFlag(argv, "--spawnType") ?? "checkpoint").toLowerCase();
    const spawnType = (spawnTypeRaw === "graveyard" ? "graveyard" : "checkpoint") as "checkpoint" | "graveyard";

    const protoId = getFlag(argv, "--protoId") ?? spawnType;
    const archetype = getFlag(argv, "--archetype") ?? spawnType;

    const borderMargin = parseInt(getFlag(argv, "--borderMargin") ?? "16", 10) || 16;

    const json = argv.includes("--json");
    const commit = argv.includes("--commit");

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
    });
    return;
  }

  // preview/apply planner args
  const seed = getFlag(argv, "--seed") ?? "seed:alpha";

  const cfg: SettlementPlanConfig = {
    seed,
    shardId,
    bounds,
    cellSize,
    baseY: 0,
    borderMargin: parseInt(getFlag(argv, "--borderMargin") ?? "16", 10) || 16,
    minCellDistance: parseInt(getFlag(argv, "--minCellDistance") ?? "3", 10) || 3,
    spawnType: getFlag(argv, "--spawnType") ?? "outpost",
    protoId: getFlag(argv, "--protoId") ?? "outpost",
    archetype: getFlag(argv, "--archetype") ?? "outpost",
  };

  const factions = parseFactions(getFlag(argv, "--factions") ?? "emberfall:2,oathbound:2");
  const actions = planInitialOutposts(factions, cfg);

  if (cmd === "preview") {
    if (argv.includes("--json")) {
      console.log(JSON.stringify(actions, null, 2));
    } else {
      console.log(`[simBrain] actions=${actions.length} seed=${seed} shard=${shardId}`);
      for (const a of actions) {
        const s = a.spawn;
        console.log(
          `- ${s.spawnId} type=${s.type} proto=${s.protoId} @ (${s.x.toFixed(2)},${s.z.toFixed(2)}) region=${s.regionId}`,
        );
      }
    }
    return;
  }

  const commit = argv.includes("--commit");
  await applyToDb(actions as any[], commit);
}

void (async () => {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    // IMPORTANT: only end the pool once, at process end.
    await db.end().catch(() => {});
  }
})();
