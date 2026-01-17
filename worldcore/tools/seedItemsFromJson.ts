// worldcore/tools/seedGraveyards.ts
//
// Seeds graveyard spawn_points on a spaced grid, with neighbor checks to avoid
// "two graveyards 5 feet apart across a region boundary".
//
// Defaults (override via env):
// - PW_GY_SHARD_ID=prime_shard
// - PW_GY_RANGE=8                 (cells from -R..R in both axes)
// - PW_GY_STRIDE=3                (place candidates every N cells)
// - PW_GY_NEIGHBOR_RADIUS=1       (skip if any graveyard exists within N cells)
// - PW_GY_CELL_SIZE=64            (world units per region cell)
// - PW_GY_BORDER_MARGIN=16        (keep spawn away from cell edges)
// - PW_GY_Y=0                     (vertical spawn; grounding comes later)
// - PW_GY_TYPE=graveyard
// - PW_GY_ARCHETYPE=graveyard
// - PW_GY_PROTO_ID=graveyard
//
// Run:
//   cd worldcore
//   npm run build
//   node ../dist/worldcore/tools/seedGraveyards.js
//
// Notes:
// - We "upsert" by spawn_id (select then insert/update), no DB constraints needed.
// - This does NOT delete anything; it only inserts/updates the chosen spawn_ids.

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

type ExistingGy = {
  spawnId: string;
  regionId: string | null;
  x: number | null;
  z: number | null;
};

const log = Logger.scope("GY_SEED");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim().length ? raw.trim() : fallback;
}

function regionIdFor(shardId: string, cx: number, cz: number): string {
  return `${shardId}:${cx},${cz}`;
}

function parseCellFromRegionId(shardId: string, regionId: string | null): { cx: number; cz: number } | null {
  if (!regionId) return null;
  // expects: "prime_shard:1,0"
  const prefix = `${shardId}:`;
  if (!regionId.startsWith(prefix)) return null;
  const rest = regionId.slice(prefix.length);
  const m = rest.match(/^(-?\d+),(-?\d+)$/);
  if (!m) return null;
  return { cx: Number(m[1]), cz: Number(m[2]) };
}

function hash32(s: string): number {
  // small deterministic hash (FNV-1a-ish)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jitterWithin(spawnId: string, maxAbs: number): number {
  if (maxAbs <= 0) return 0;
  const h = hash32(spawnId);
  // map to [-maxAbs, +maxAbs]
  const t = (h % (maxAbs * 2 + 1)) - maxAbs;
  return t;
}

async function loadExistingGraveyards(shardId: string, type: string): Promise<Map<string, ExistingGy[]>> {
  const res = await db.query(
    `SELECT spawn_id, region_id, x, z
     FROM spawn_points
     WHERE shard_id = $1 AND type = $2`,
    [shardId, type],
  );

  const byCell = new Map<string, ExistingGy[]>();

  for (const row of res.rows as any[]) {
    const gy: ExistingGy = {
      spawnId: String(row.spawn_id),
      regionId: row.region_id ? String(row.region_id) : null,
      x: row.x === null ? null : Number(row.x),
      z: row.z === null ? null : Number(row.z),
    };

    // Prefer region_id parse; fallback to x/z -> cell
    let cell = parseCellFromRegionId(shardId, gy.regionId);
    if (!cell && gy.x !== null && gy.z !== null) {
      // best-effort: center-based cell
      // (this is only used for neighbor-skip behavior)
      const cx = Math.round((gy.x - 32) / 64);
      const cz = Math.round((gy.z - 32) / 64);
      cell = { cx, cz };
    }

    if (!cell) continue;

    const key = `${cell.cx},${cell.cz}`;
    const arr = byCell.get(key) ?? [];
    arr.push(gy);
    byCell.set(key, arr);
  }

  return byCell;
}

function hasNeighborGy(
  byCell: Map<string, ExistingGy[]>,
  cx: number,
  cz: number,
  r: number,
): boolean {
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const key = `${cx + dx},${cz + dz}`;
      if (byCell.has(key)) return true;
    }
  }
  return false;
}

async function upsertSpawnPoint(args: {
  shardId: string;
  spawnId: string;
  type: string;
  archetype: string;
  protoId: string | null;
  variantId: string | null;
  x: number;
  y: number;
  z: number;
  regionId: string;
}): Promise<"inserted" | "updated"> {
  const found = await db.query(
    `SELECT id FROM spawn_points WHERE shard_id = $1 AND spawn_id = $2 LIMIT 1`,
    [args.shardId, args.spawnId],
  );

  if ((found.rows?.length ?? 0) > 0) {
    const id = Number((found.rows[0] as any).id);
    await db.query(
      `UPDATE spawn_points
         SET type = $1,
             archetype = $2,
             proto_id = $3,
             variant_id = $4,
             x = $5,
             y = $6,
             z = $7,
             region_id = $8
       WHERE id = $9`,
      [
        args.type,
        args.archetype,
        args.protoId,
        args.variantId,
        args.x,
        args.y,
        args.z,
        args.regionId,
        id,
      ],
    );
    return "updated";
  }

  await db.query(
    `INSERT INTO spawn_points (shard_id, spawn_id, type, archetype, proto_id, variant_id, x, y, z, region_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      args.shardId,
      args.spawnId,
      args.type,
      args.archetype,
      args.protoId,
      args.variantId,
      args.x,
      args.y,
      args.z,
      args.regionId,
    ],
  );
  return "inserted";
}

async function main() {
  const shardId = envStr("PW_GY_SHARD_ID", "prime_shard");
  const range = Math.max(0, envInt("PW_GY_RANGE", 8));
  const stride = Math.max(1, envInt("PW_GY_STRIDE", 3));
  const neighborRadius = Math.max(0, envInt("PW_GY_NEIGHBOR_RADIUS", 1));
  const cellSize = Math.max(1, envInt("PW_GY_CELL_SIZE", 64));
  const borderMargin = Math.max(0, envInt("PW_GY_BORDER_MARGIN", 16));
  const baseY = envInt("PW_GY_Y", 0);

  const type = envStr("PW_GY_TYPE", "graveyard");
  const archetype = envStr("PW_GY_ARCHETYPE", "graveyard");
  const protoId = envStr("PW_GY_PROTO_ID", "graveyard");
  const variantId = process.env.PW_GY_VARIANT_ID?.trim() || null;

  // Jitter limit so we never spawn on the border:
  const half = cellSize / 2;
  const maxJitter = Math.max(0, Math.floor(half - borderMargin));

  log.info("Seeding graveyards", {
    shardId,
    range,
    stride,
    neighborRadius,
    cellSize,
    borderMargin,
    baseY,
    type,
    archetype,
    protoId,
    variantId,
  });

  await db.query("BEGIN");
  try {
    const existingByCell = await loadExistingGraveyards(shardId, type);

    let inserted = 0;
    let updated = 0;
    let skippedNeighbor = 0;

    for (let cz = -range; cz <= range; cz++) {
      for (let cx = -range; cx <= range; cx++) {
        // Place only on a spaced grid:
        if ((cx % stride) !== 0 || (cz % stride) !== 0) continue;

        // Don't crowd: if any graveyard exists in nearby cells, skip.
        if (hasNeighborGy(existingByCell, cx, cz, neighborRadius)) {
          skippedNeighbor++;
          continue;
        }

        const spawnId = `gy_${cx}_${cz}`;
        const regionId = regionIdFor(shardId, cx, cz);

        // Center of the cell, plus deterministic jitter (safe from borders).
        const baseX = cx * cellSize + half;
        const baseZ = cz * cellSize + half;
        const jx = jitterWithin(spawnId + "_x", maxJitter);
        const jz = jitterWithin(spawnId + "_z", maxJitter);

        const x = baseX + jx;
        const z = baseZ + jz;

        const result = await upsertSpawnPoint({
          shardId,
          spawnId,
          type,
          archetype,
          protoId: protoId || null,
          variantId,
          x,
          y: baseY,
          z,
          regionId,
        });

        // Mark this cell as now containing a graveyard so future candidates skip it.
        const key = `${cx},${cz}`;
        existingByCell.set(key, [
          { spawnId, regionId, x, z },
        ]);

        if (result === "inserted") inserted++;
        else updated++;
      }
    }

    await db.query("COMMIT");
    log.success("Graveyard seeding complete", { inserted, updated, skippedNeighbor });
  } catch (err) {
    await db.query("ROLLBACK");
    log.error("Graveyard seeding failed", { err });
    process.exitCode = 1;
  }
}

main().then(() => {});
