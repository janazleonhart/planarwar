// worldcore/tools/simBrain.ts
/* eslint-disable no-console */

import { db } from "../db/Database";
import type * as pg from "pg";

import { planInitialOutposts } from "../sim/SettlementPlanner";
import type { FactionSeedSpec, SettlementPlanConfig } from "../sim/SettlementPlanner";
import type { Bounds } from "../sim/SimGrid";

type Cmd = "preview" | "apply" | "help";

function usage(): void {
  console.log(`
Planar War — Dev Simulation Harness (WorldCore)

Usage:
  node dist/worldcore/tools/simBrain.js preview [options]
  node dist/worldcore/tools/simBrain.js apply   [options] [--commit]

Options:
  --seed <seed>                 deterministic seed (default: seed:alpha)
  --shard <shardId>             shard id (default: prime_shard)
  --bounds <cx..cx,cz..cz>      cell bounds (default: -4..4,-4..4)
  --cellSize <n>                cell size in world units (default: 64)
  --minCellDistance <n>         spacing in CELLS (default: 3)
  --borderMargin <n>            in-cell border margin (default: 16)
  --factions <list>             e.g. emberfall:2,oathbound:3
  --spawnType <type>            default: outpost
  --protoId <protoId>           default: outpost
  --archetype <archetype>       default: outpost
  --commit                      apply only: commit to DB (otherwise rollback)
  --json                        preview only: print JSON actions
`.trim());
}

function getFlag(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  const v = argv[idx + 1];
  if (!v || v.startsWith("--")) return null;
  return v;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseBounds(input: string): Bounds {
  // "-4..4,-4..4"
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
  // "emberfall:2,oathbound:3"
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
      console.log(
        `[simBrain] rolled back (dry-run). inserted=${inserted} updated=${updated} (use --commit)`,
      );
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
    await db.end().catch(() => {});
  }
}

async function main(argv: string[]): Promise<void> {
  const cmd = ((argv[0] || "help").toLowerCase() as Cmd) ?? "help";
  if (cmd !== "preview" && cmd !== "apply") {
    usage();
    return;
  }

  const seed = getFlag(argv, "--seed") ?? "seed:alpha";
  const shardId = getFlag(argv, "--shard") ?? "prime_shard";
  const bounds = parseBounds(getFlag(argv, "--bounds") ?? "-4..4,-4..4");

  const cfg: SettlementPlanConfig = {
    seed,
    shardId,
    bounds,
    cellSize: parseInt(getFlag(argv, "--cellSize") ?? "64", 10) || 64,
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
    if (hasFlag(argv, "--json")) {
      console.log(JSON.stringify(actions, null, 2));
    } else {
      console.log(`[simBrain] actions=${actions.length} seed=${seed} shard=${shardId}`);
      for (const a of actions) {
        const s = a.spawn;
        console.log(
          `- ${s.spawnId} type=${s.type} proto=${s.protoId} @ (${s.x.toFixed(2)},${s.z.toFixed(
            2,
          )}) region=${s.regionId}`,
        );
      }
    }
    return;
  }

  const commit = hasFlag(argv, "--commit");
  await applyToDb(actions as any[], commit);
}

void main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
