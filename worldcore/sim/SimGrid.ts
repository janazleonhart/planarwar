// worldcore/sim/SimGrid.ts
// Shared helpers for region/cell math.

export type ShardId = string;

export type Cell = {
  cx: number;
  cz: number;
};

export type Bounds = {
  minCx: number;
  maxCx: number;
  minCz: number;
  maxCz: number;
};

export type WorldPos = {
  x: number;
  y: number;
  z: number;
};

export function makeRegionId(shardId: ShardId, cell: Cell): string {
  return `${shardId}:${cell.cx},${cell.cz}`;
}

export function parseRegionId(regionId: string): { shardId: string; cell: Cell } | null {
  const idx = regionId.indexOf(":");
  if (idx <= 0) return null;

  const shardId = regionId.slice(0, idx);
  const rest = regionId.slice(idx + 1);

  const m = rest.match(/^(-?\d+),(-?\d+)$/);
  if (!m) return null;

  return {
    shardId,
    cell: { cx: Number(m[1]), cz: Number(m[2]) },
  };
}

export function cellCenter(cell: Cell, cellSize: number): { x: number; z: number } {
  const half = cellSize / 2;
  return {
    x: cell.cx * cellSize + half,
    z: cell.cz * cellSize + half,
  };
}

export function cellBounds(
  cell: Cell,
  cellSize: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const minX = cell.cx * cellSize;
  const maxX = (cell.cx + 1) * cellSize;
  const minZ = cell.cz * cellSize;
  const maxZ = (cell.cz + 1) * cellSize;
  return { minX, maxX, minZ, maxZ };
}

export function inBounds(cell: Cell, b: Bounds): boolean {
  return cell.cx >= b.minCx && cell.cx <= b.maxCx && cell.cz >= b.minCz && cell.cz <= b.maxCz;
}

export function euclidCellDist(a: Cell, b: Cell): number {
  const dx = a.cx - b.cx;
  const dz = a.cz - b.cz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function clampInt(n: number, min: number, max: number): number {
  const x = Math.trunc(n);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}
