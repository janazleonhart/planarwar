// worldcore/sim/GapFiller.ts
// Gap filling planner: adds respawn sources (checkpoint/graveyard) only where coverage gaps exist.
//
// Strategy (v0):
// - Compute respawn coverage across bounds (cell centers)
// - While gaps remain and under maxPlace:
//   - pick the worst gap (farthest from any eligible respawn source)
//   - place a checkpoint/graveyard at the CELL CENTER (no jitter; coverage-optimal)
//   - enforce minDistance from existing + newly placed checkpoint/graveyard spawns
//   - add it and recompute coverage (so we don't over-place)

import type { Bounds, ShardId } from "./SimGrid";
import { cellCenter, makeRegionId } from "./SimGrid";
import { computeRespawnCoverage } from "./RespawnCoverage";
import type { SpawnForCoverage, CellCoverageRow } from "./RespawnCoverage";

export type GapFillSpawn = {
  shardId: ShardId;
  spawnId: string;
  type: string;
  protoId: string;
  variantId: string | null;
  archetype: string;
  x: number;
  y: number;
  z: number;
  regionId: string;
};

export type GapFillPlanConfig = {
  seed: number | string;

  shardId: ShardId;
  bounds: Bounds;

  cellSize: number;
  baseY: number;
  borderMargin: number;

  respawnRadius: number; // world units
  minDistance: number;   // world units between checkpoints/graveyards
  maxPlace: number;

  // what to place
  spawnType: "checkpoint" | "graveyard";
  protoId: string;
  archetype: string;

  // which types should block "too close"
  blockerTypes?: Set<string>; // default: graveyard+checkpoint
};

const DEFAULT_BLOCKER_TYPES = new Set(["graveyard", "checkpoint"]);

export function planGapFillSpawns(
  existingSpawns: readonly SpawnForCoverage[],
  cfg: GapFillPlanConfig,
): GapFillSpawn[] {
  const cellSize = Math.max(1, Math.floor(cfg.cellSize));
  const radius = Math.max(0, cfg.respawnRadius);
  const minDist = Math.max(0, cfg.minDistance);
  const maxPlace = Math.max(0, Math.floor(cfg.maxPlace));

  const blockerTypes = cfg.blockerTypes ?? DEFAULT_BLOCKER_TYPES;

  const placed: GapFillSpawn[] = [];

  // For distance blocking, consider only checkpoint/graveyard (or configured blockerTypes).
  const blockers: { x: number; z: number; type: string }[] = [];
  for (const s of existingSpawns) {
    const t = (s.type || "").toLowerCase();
    if (blockerTypes.has(t)) blockers.push({ x: s.x, z: s.z, type: t });
  }

  for (let iter = 0; iter < maxPlace; iter++) {
    const coverageInputs: SpawnForCoverage[] = [
      ...existingSpawns,
      ...placed.map((p) => ({
        spawnId: p.spawnId,
        type: p.type,
        x: p.x,
        z: p.z,
        variantId: p.variantId,
      })),
    ];

    const { rows, summary } = computeRespawnCoverage(coverageInputs, {
      bounds: cfg.bounds,
      cellSize,
      respawnRadius: radius,
    });

    if (summary.gapCells <= 0) break;

    const worst = pickWorstGap(rows);
    if (!worst) break;

    const proposed = proposeSpawnAtCellCenter(worst.cx, worst.cz, cfg);

    // Enforce minDistance from blockers (existing + newly placed checkpoint/graveyards).
    if (minDist > 0 && tooCloseToAny(proposed.x, proposed.z, blockers, minDist)) {
      // v0 behavior: if the best cell is blocked, skip it and continue.
      // Future: pick next-worst, or try alternate points.
      continue;
    }

    placed.push(proposed);
    blockers.push({ x: proposed.x, z: proposed.z, type: proposed.type.toLowerCase() });
  }

  return placed;
}

function pickWorstGap(rows: readonly CellCoverageRow[]): CellCoverageRow | null {
  let best: CellCoverageRow | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const r of rows) {
    if (r.covered) continue;

    // nearestDistance can be Infinity if there are no eligible spawns at all.
    const score = r.nearestDistance;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  return best;
}

function proposeSpawnAtCellCenter(cx: number, cz: number, cfg: GapFillPlanConfig): GapFillSpawn {
  const cellSize = Math.max(1, Math.floor(cfg.cellSize));
  const center = cellCenter({ cx, cz }, cellSize);

  const regionId = makeRegionId(cfg.shardId, { cx, cz });

  // Deterministic spawnId per cell so reruns update rather than duplicate.
  const spawnId = `${cfg.spawnType}_gap_${cx}_${cz}`;

  return {
    shardId: cfg.shardId,
    spawnId,
    type: cfg.spawnType,
    protoId: cfg.protoId,
    variantId: null,
    archetype: cfg.archetype,
    x: center.x,
    y: cfg.baseY ?? 0,
    z: center.z,
    regionId,
  };
}

function tooCloseToAny(x: number, z: number, pts: readonly { x: number; z: number }[], minDist: number): boolean {
  const min2 = minDist * minDist;
  for (const p of pts) {
    const dx = p.x - x;
    const dz = p.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < min2) return true;
  }
  return false;
}
