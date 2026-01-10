// worldcore/tools/resourceBaseline.ts
/* eslint-disable no-console */

import { db } from "../db/Database";
import { Logger } from "../utils/logger";
import type { Bounds } from "../sim/SimGrid";
import {
  buildDefaultResourceConfig,
  planResourceBaselinesForWorld,
} from "../sim/ResourceBaselineModule";

const log = Logger.scope("RESOURCE_BASELINE");

type Cmd = "preview" | "apply";

interface SpawnRow {
  shardId: string;
  spawnId: string;
  type: string;
  archetype: string | null;
  protoId: string | null;
  variantId: string | null;
  x: number | null;
  z: number | null;
  regionId: string | null;
}

// We treat these spawn_points.type values as "settlements"
// that anchor resource baselines.
const SETTLEMENT_TYPES = new Set<string>([
  "town",
  "outpost",
  "hub",
  "village",
  "city",
  "settlement",
  "camp",
]);

function usage(): void {
  console.log(
    [
      "Planar War — Resource Baseline Harness",
      "",
      "Usage:",
      "  node dist/worldcore/tools/resourceBaseline.js preview [options]",
      "  node dist/worldcore/tools/resourceBaseline.js apply [options] [--commit]",
      "",
      "Options:",
      "  --shard       Shard id (default: prime_shard)",
      '  --bounds      Cell bounds, e.g. "-8..8,-8..8" (default: -4..4,-4..4)',
      "  --cellSize    Cell size in world units (default: 64)",
      "  --seed        Optional deterministic seed id",
      "  --json        Print full planner output JSON",
      "  --commit      Actually write spawn_points (only with apply)",
      "",
      "Examples:",
      '  node dist/worldcore/tools/resourceBaseline.js preview --bounds "-8..8,-8..8"',
      '  node dist/worldcore/tools/resourceBaseline.js apply --bounds "-8..8,-8..8" --commit',
      "",
    ].join("\n"),
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

function parseRange(raw: string): [number, number] {
  const [loRaw, hiRaw] = raw.split("..").map((x) => x.trim());
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

function isoSlug(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

function boundsSlug(b: Bounds): string {
  return `${b.minCx}..${b.maxCx},${b.minCz}..${b.maxCz}`;
}

function assertNoEllipsisArgs(argv: string[]): void {
  if (argv.includes("...") || argv.includes("…")) {
    throw new Error(
      'Refusing to run: found literal "..." argument. Remove it; it triggers defaults.',
    );
  }
}

function assertCommitHasExplicitBounds(argv: string[], commit: boolean): void {
  if (!commit) return;
  if (hasFlag(argv, "--allowDefaultBounds")) return;
  if (!hasFlag(argv, "--bounds")) {
    throw new Error(
      "Refusing to --commit without explicit --bounds. Pass --allowDefaultBounds to override (not recommended).",
    );
  }
}

/**
 * Load spawn_points for the given shard + bounds and map them into
 * the light-weight shape the resource planner expects.
 */
async function loadSpawns(
  shardId: string,
  bounds: Bounds,
  cellSize: number,
): Promise<SpawnRow[]> {
  const minX = bounds.minCx * cellSize;
  const maxX = (bounds.maxCx + 1) * cellSize;
  const minZ = bounds.minCz * cellSize;
  const maxZ = (bounds.maxCz + 1) * cellSize;

  const res = await db.query(
    `
    SELECT shard_id, spawn_id, type, archetype, proto_id, variant_id, x, z, region_id
    FROM spawn_points
    WHERE shard_id = $1
      AND x BETWEEN $2 AND $3
      AND z BETWEEN $4 AND $5
  `,
    [shardId, minX, maxX, minZ, maxZ],
  );

  const rows = (res.rows ?? []) as any[];

  return rows.map((row) => ({
    shardId: String(row.shard_id),
    spawnId: String(row.spawn_id),
    type: String(row.type),
    archetype: row.archetype == null ? null : String(row.archetype),
    protoId: row.proto_id == null ? null : String(row.proto_id),
    variantId: row.variant_id == null ? null : String(row.variant_id),
    x: row.x == null ? null : Number(row.x),
    z: row.z == null ? null : Number(row.z),
    regionId: row.region_id == null ? null : String(row.region_id),
  }));
}

/**
 * Build the minimal region snapshot array the planner needs.
 *
 * NOTE: this shape must line up with ResourceBaselineModule.RegionSnapshot:
 *  - regionId, shardId, cellX, cellZ
 *  - baseTier, dangerTier
 *  - spawns[], settlements[]
 */
function buildRegionSnapshots(
  shardId: string,
  bounds: Bounds,
  cellSize: number,
  spawns: SpawnRow[],
): any[] {
  const regions = new Map<string, any>();

  // Seed a RegionSnapshot for each cell in bounds
  for (let cz = bounds.minCz; cz <= bounds.maxCz; cz++) {
    for (let cx = bounds.minCx; cx <= bounds.maxCx; cx++) {
      const regionId = `${shardId}:${cx},${cz}`;
      regions.set(regionId, {
        regionId,
        shardId,
        cellX: cx,
        cellZ: cz,
        baseTier: 1,
        dangerTier: 1, // <-- important: matches planner's field name
        dangerScore: 0,
        spawns: [] as any[],
        settlements: [] as any[],
      });
    }
  }

  for (const s of spawns) {
    if (s.x == null || s.z == null) continue;
    const cx = Math.floor(s.x / cellSize);
    const cz = Math.floor(s.z / cellSize);
    if (
      cx < bounds.minCx ||
      cx > bounds.maxCx ||
      cz < bounds.minCz ||
      cz > bounds.maxCz
    ) {
      continue;
    }

    const regionId = `${shardId}:${cx},${cz}`;
    const region = regions.get(regionId);
    if (!region) continue;

    const spawnSnap = {
      spawnId: s.spawnId,
      type: s.type,
      archetype: s.archetype,
      protoId: s.protoId,
      variantId: s.variantId,
      x: s.x,
      z: s.z,
    };
    region.spawns.push(spawnSnap);

    if (SETTLEMENT_TYPES.has(s.type)) {
      region.settlements.push({
        id: s.spawnId,
        kind: s.type,
        x: s.x,
        z: s.z,
      });
    }
  }

  return [...regions.values()];
}

/**
 * Apply planner "place_spawn" actions to spawn_points in Postgres.
 *
 * We assume each action has the shape:
 *   { kind: "place_spawn", spawn: { spawnId, type, archetype, protoId, variantId, x, y, z, regionId } }
 *
 * The planner itself is DB-agnostic, so this is a very thin upsert layer.
 */
async function applyToDb(params: {
  shardId: string;
  actions: any[];
  commit: boolean;
}): Promise<{ inserted: number; updated: number; skipped: number }> {
  const { shardId, actions, commit } = params;

  if (!actions.length) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  await db.query("BEGIN");
  try {
    for (const action of actions) {
      if (!action || action.kind !== "place_spawn" || !action.spawn) {
        skipped++;
        continue;
      }

      const spawn = action.spawn as any;
      const spawnId: string = String(spawn.spawnId ?? spawn.spawn_id);
      const type: string = String(spawn.type ?? "resource");
      const archetype: string = String(spawn.archetype ?? "resource");
      const protoId: string | null =
        spawn.protoId == null ? null : String(spawn.protoId);
      const variantId: string | null =
        spawn.variantId == null ? null : String(spawn.variantId);
      const x: number = Number(spawn.x ?? 0);
      const y: number = Number(spawn.y ?? 0);
      const z: number = Number(spawn.z ?? 0);
      const regionId: string = String(
        spawn.regionId ?? `${shardId}:${Math.floor(x / 64)},${Math.floor(z / 64)}`,
      );

      const found = await db.query(
        `
        SELECT id
        FROM spawn_points
        WHERE shard_id = $1 AND spawn_id = $2
        LIMIT 1
      `,
        [shardId, spawnId],
      );

      if ((found.rows?.length ?? 0) > 0) {
        const id = Number((found.rows[0] as any).id);
        await db.query(
          `
          UPDATE spawn_points
          SET type = $1,
              archetype = $2,
              proto_id = $3,
              variant_id = $4,
              x = $5,
              y = $6,
              z = $7,
              region_id = $8
          WHERE id = $9
        `,
          [type, archetype, protoId, variantId, x, y, z, regionId, id],
        );
        updated++;
      } else {
        await db.query(
          `
          INSERT INTO spawn_points
            (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
          [shardId, spawnId, type, archetype, protoId, variantId, x, y, z, regionId],
        );
        inserted++;
      }
    }

    if (commit) {
      await db.query("COMMIT");
    } else {
      await db.query("ROLLBACK");
    }

    return { inserted, updated, skipped };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
    usage();
    return;
  }

  const cmdRaw = argv[0];
  if (cmdRaw !== "preview" && cmdRaw !== "apply") {
    usage();
    process.exitCode = 1;
    return;
  }
  const cmd: Cmd = cmdRaw;
  const args = argv.slice(1);

  assertNoEllipsisArgs(args);

  const shardId = getFlag(args, "--shard") ?? "prime_shard";
  const boundsStr = getFlag(args, "--bounds") ?? "-4..4,-4..4";
  const cellSize = parseIntFlag(args, "--cellSize", 64);
  const commit = hasFlag(args, "--commit");
  const jsonOut = hasFlag(args, "--json");

  assertCommitHasExplicitBounds(args, commit && cmd === "apply");

  const bounds = parseBounds(boundsStr);
  const seed =
    getFlag(args, "--seed") ??
    `resource_baseline:${shardId}:${boundsSlug(bounds)}:${isoSlug()}`;

  log.info("Resource baseline planner starting", {
    cmd,
    shardId,
    bounds,
    cellSize,
    commit,
    seed,
  });

  const spawns = await loadSpawns(shardId, bounds, cellSize);
  const regions = buildRegionSnapshots(shardId, bounds, cellSize, spawns);
  const cfg: any = buildDefaultResourceConfig(seed);
  const worldPlan: any = planResourceBaselinesForWorld(regions, cfg);

  const regionPlans: any[] = Array.isArray(worldPlan?.regions)
    ? worldPlan.regions
    : [];
  const actions: any[] = Array.isArray(worldPlan?.actions)
    ? worldPlan.actions
    : [];

  const totalPlaced = regionPlans.reduce(
    (sum, r) => sum + Number(r?.totalPlaced ?? 0),
    0,
  );

  log.info("Planner summary", {
    regions: regions.length,
    regionPlans: regionPlans.length,
    actions: actions.length,
    totalPlaced,
  });

  if (jsonOut) {
    // Avoid interleaving with log lines
    process.stdout.write(
      JSON.stringify(
        {
          shardId,
          bounds,
          seed,
          regions,
          worldPlan,
        },
        null,
        2,
      ) + "\n",
    );
  }

  if (cmd === "preview") {
    console.log(
      `[resource] PREVIEW ONLY — planned ${totalPlaced} placements as ${actions.length} actions.`,
    );
    return;
  }

  // cmd === "apply"
  const { inserted, updated, skipped } = await applyToDb({
    shardId,
    actions,
    commit,
  });

  console.log(
    `[resource] ${commit ? "APPLY" : "DRY-RUN"} complete. inserted=${inserted}, updated=${updated}, skipped=${skipped}`,
  );
}

main().catch((err) => {
  log.error("Resource baseline tool failed", { err });
  process.exitCode = 1;
});
