// worldcore/sim/RespawnCoverage.ts
// Respawn coverage auditing utilities for the Dev Simulation Harness.
//
// The goal:
// - Scan a cell bounds box
// - For each cell center, find nearest eligible "respawn" spawn point
// - Mark covered if distance <= respawnRadius
//
// Eligibility rules (v0):
// - Graveyards/checkpoints: always eligible
// - Settlements (town/hub/village/city/settlement/outpost): eligible unless variantId === "kos"
// - Other spawn types: ignored for respawn coverage

import type { Bounds } from "./SimGrid";

export type SpawnForCoverage = {
  spawnId: string;
  type: string;
  x: number;
  z: number;
  variantId?: string | null;
};

export type CellCoverageRow = {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;

  covered: boolean;

  nearestSpawnId: string | null;
  nearestSpawnType: string | null;
  nearestDistance: number; // world units (Infinity if none)
};

export type CoverageSummary = {
  totalCells: number;
  coveredCells: number;
  gapCells: number;
  coveragePct: number; // 0..100
};

export type CoverageConfig = {
  bounds: Bounds;
  cellSize: number;
  respawnRadius: number;

  // optional overrides
  settlementTypes?: Set<string>;
  graveyardTypes?: Set<string>;
};

const DEFAULT_SETTLEMENT_TYPES = new Set([
  "town",
  "hub",
  "village",
  "city",
  "settlement",
  "outpost",
]);

const DEFAULT_GRAVEYARD_TYPES = new Set(["graveyard", "checkpoint"]);

export function computeRespawnCoverage(
  spawns: readonly SpawnForCoverage[],
  cfg: CoverageConfig,
): { rows: CellCoverageRow[]; summary: CoverageSummary } {
  const cellSize = Math.max(1, Math.floor(cfg.cellSize));
  const radius = Math.max(0, cfg.respawnRadius);
  const radius2 = radius * radius;

  const settlementTypes = cfg.settlementTypes ?? DEFAULT_SETTLEMENT_TYPES;
  const graveyardTypes = cfg.graveyardTypes ?? DEFAULT_GRAVEYARD_TYPES;

  // Filter to eligible respawn sources up front.
  const eligible = spawns.filter((s) => isEligibleRespawnSpawn(s, settlementTypes, graveyardTypes));

  const rows: CellCoverageRow[] = [];

  for (let cz = cfg.bounds.minCz; cz <= cfg.bounds.maxCz; cz++) {
    for (let cx = cfg.bounds.minCx; cx <= cfg.bounds.maxCx; cx++) {
      const centerX = cx * cellSize + cellSize / 2;
      const centerZ = cz * cellSize + cellSize / 2;

      const nearest = findNearest(centerX, centerZ, eligible);

      const covered = nearest.distance2 <= radius2;

      rows.push({
        cx,
        cz,
        centerX,
        centerZ,
        covered: Number.isFinite(nearest.distance2) ? covered : false,
        nearestSpawnId: nearest.spawn?.spawnId ?? null,
        nearestSpawnType: nearest.spawn?.type ?? null,
        nearestDistance: Number.isFinite(nearest.distance2) ? Math.sqrt(nearest.distance2) : Number.POSITIVE_INFINITY,
      });
    }
  }

  const totalCells = rows.length;
  const coveredCells = rows.filter((r) => r.covered).length;
  const gapCells = totalCells - coveredCells;
  const coveragePct = totalCells > 0 ? (coveredCells / totalCells) * 100 : 0;

  return {
    rows,
    summary: { totalCells, coveredCells, gapCells, coveragePct },
  };
}

function isEligibleRespawnSpawn(
  s: SpawnForCoverage,
  settlementTypes: Set<string>,
  graveyardTypes: Set<string>,
): boolean {
  const t = (s.type || "").toLowerCase();

  if (graveyardTypes.has(t)) return true;

  if (settlementTypes.has(t)) {
    // v0: KOS settlements are ineligible
    return (s.variantId ?? null) !== "kos";
  }

  return false;
}

function findNearest(
  x: number,
  z: number,
  spawns: readonly SpawnForCoverage[],
): { spawn: SpawnForCoverage | null; distance2: number } {
  let best: SpawnForCoverage | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;

  for (const s of spawns) {
    const dx = s.x - x;
    const dz = s.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = s;
    }
  }

  return { spawn: best, distance2: bestD2 };
}
