// worldcore/sim/SettlementPlanner.ts
// v0: deterministic outpost placement with spacing constraints.

import type { Bounds, Cell, ShardId } from "./SimGrid";
import { cellBounds, cellCenter, makeRegionId } from "./SimGrid";
import { SimRng } from "./SimRng";
import type { BrainAction, PlaceSpawnAction } from "./BrainActions";

export type FactionSeedSpec = {
  factionId: string;
  count: number;
};

export type SettlementPlanConfig = {
  seed: number | string;
  shardId: ShardId;
  bounds: Bounds;

  // world geometry assumptions
  cellSize: number; // default 64
  baseY: number; // default 0
  borderMargin: number; // keep away from edges, default 16

  // spacing rule (in cell units)
  minCellDistance: number; // default 3

  // spawn typing
  spawnType: string; // default "outpost"
  protoId: string; // default "outpost"
  archetype: string; // default "outpost"
};

export function planInitialOutposts(
  factions: readonly FactionSeedSpec[],
  cfg: SettlementPlanConfig,
): BrainAction[] {
  const rng = new SimRng(cfg.seed);

  const allCells: Cell[] = [];
  for (let cz = cfg.bounds.minCz; cz <= cfg.bounds.maxCz; cz++) {
    for (let cx = cfg.bounds.minCx; cx <= cfg.bounds.maxCx; cx++) {
      allCells.push({ cx, cz });
    }
  }

  const candidates = rng.shuffle(allCells);

  const chosen: { cell: Cell; factionId: string; index: number }[] = [];

  const queue: { factionId: string; index: number }[] = [];
  for (const f of factions) {
    const n = Math.max(0, Math.trunc(f.count));
    for (let i = 0; i < n; i++) queue.push({ factionId: f.factionId, index: i });
  }
  const placementOrder = rng.shuffle(queue);

  for (const req of placementOrder) {
    const best = pickBestCell(candidates, chosen, cfg.minCellDistance);
    if (!best) break;
    chosen.push({ cell: best, factionId: req.factionId, index: req.index });
  }

  return chosen.map((c) => toPlaceSpawnAction(c.factionId, c.index, c.cell, cfg));
}

function pickBestCell(
  candidates: readonly Cell[],
  chosen: readonly { cell: Cell }[],
  minCellDistance: number,
): Cell | null {
  if (candidates.length === 0) return null;

  let best: Cell | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const cell of candidates) {
    const dMin = minDistanceToChosen(cell, chosen);

    if (chosen.length > 0 && dMin < minCellDistance) continue;

    const score = dMin;
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }

  return best;
}

function minDistanceToChosen(cell: Cell, chosen: readonly { cell: Cell }[]): number {
  if (chosen.length === 0) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;
  for (const c of chosen) {
    const dx = cell.cx - c.cell.cx;
    const dz = cell.cz - c.cell.cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }
  return best;
}

function toPlaceSpawnAction(
  factionId: string,
  index: number,
  cell: Cell,
  cfg: SettlementPlanConfig,
): PlaceSpawnAction {
  const center = cellCenter(cell, cfg.cellSize);
  const bounds = cellBounds(cell, cfg.cellSize);

  const maxJitter = Math.max(0, Math.floor(cfg.cellSize / 2 - cfg.borderMargin));

  const hx = SimRng.hash32(`sx:${cfg.shardId}:${factionId}:${index}:${cell.cx},${cell.cz}`);
  const hz = SimRng.hash32(`sz:${cfg.shardId}:${factionId}:${index}:${cell.cx},${cell.cz}`);

  const jx = maxJitter === 0 ? 0 : (hx % (maxJitter * 2 + 1)) - maxJitter;
  const jz = maxJitter === 0 ? 0 : (hz % (maxJitter * 2 + 1)) - maxJitter;

  const x = clamp(center.x + jx, bounds.minX + cfg.borderMargin, bounds.maxX - cfg.borderMargin);
  const z = clamp(center.z + jz, bounds.minZ + cfg.borderMargin, bounds.maxZ - cfg.borderMargin);

  const spawnId = `outpost_${sanitizeId(factionId)}_${index}_${cell.cx}_${cell.cz}`;
  const regionId = makeRegionId(cfg.shardId, cell);

  return {
    kind: "place_spawn",
    spawn: {
      shardId: cfg.shardId,
      spawnId,
      type: cfg.spawnType,
      protoId: cfg.protoId,
      variantId: null,
      archetype: cfg.archetype,
      x,
      y: cfg.baseY,
      z,
      regionId,
      meta: {
        factionId,
        settlementKind: "outpost",
      },
    },
  };
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}
