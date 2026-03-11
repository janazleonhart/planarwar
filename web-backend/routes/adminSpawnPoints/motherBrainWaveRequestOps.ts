// web-backend/routes/adminSpawnPoints/motherBrainWaveRequestOps.ts

import {
  parseCellBounds,
  toWorldBox,
  type CellBounds,
  type MotherBrainWaveBudgetConfig,
  type MotherBrainWaveRequest,
  type WorldBox,
} from "./opsPreview";

export type ParsedMotherBrainWaveRequest = {
  shardId: string;
  rawBounds: string;
  cellSize: number;
  borderMargin: number;
  placeInset: number;
  seed: string;
  epoch: number;
  theme: string;
  count: number;
  append: boolean;
  updateExisting: boolean;
  commit: boolean;
  parsedBounds: CellBounds;
  box: WorldBox;
  budget: MotherBrainWaveBudgetConfig;
};

const DEFAULT_BUDGET: Required<MotherBrainWaveBudgetConfig> = {
  maxTotalInBounds: 5000,
  maxThemeInBounds: 2500,
  maxEpochThemeInBounds: 2000,
  maxNewInserts: 1000,
};

export function capBudgetOrNull(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.floor(numeric);
  if (normalized <= 0) return null;
  return normalized;
}

export function normalizeMotherBrainWaveBudget(
  budget: MotherBrainWaveRequest["budget"],
  defaults: MotherBrainWaveBudgetConfig = DEFAULT_BUDGET,
): MotherBrainWaveBudgetConfig {
  return {
    maxTotalInBounds: capBudgetOrNull(budget?.maxTotalInBounds, defaults.maxTotalInBounds ?? null),
    maxThemeInBounds: capBudgetOrNull(budget?.maxThemeInBounds, defaults.maxThemeInBounds ?? null),
    maxEpochThemeInBounds: capBudgetOrNull(
      budget?.maxEpochThemeInBounds,
      defaults.maxEpochThemeInBounds ?? null,
    ),
    maxNewInserts: capBudgetOrNull(budget?.maxNewInserts, defaults.maxNewInserts ?? null),
  };
}

export function parseMotherBrainWaveRequest(body: MotherBrainWaveRequest): ParsedMotherBrainWaveRequest {
  const shardId = String(body?.shardId ?? "prime_shard");
  const rawBounds = String(body?.bounds ?? "-4..4,-4..4");
  const cellSize = Math.max(1, Math.min(256, Number(body?.cellSize ?? 64) || 64));
  const borderMargin = Math.max(0, Math.min(25, Number(body?.borderMargin ?? 0) || 0));
  const placeInset = Math.max(0, Math.min(Math.floor(cellSize / 2), Number(body?.placeInset ?? 0) || 0));
  const seed = String(body?.seed ?? "seed:mother");
  const epoch = Math.max(0, Number(body?.epoch ?? 0) || 0);
  const theme = String(body?.theme ?? "goblins");
  const count = Math.max(1, Math.min(5000, Number(body?.count ?? 8) || 8));
  const append = Boolean(body?.append ?? false);
  const updateExisting = Boolean(body?.updateExisting ?? false);
  const commit = Boolean(body?.commit ?? false);
  const parsedBounds = parseCellBounds(rawBounds);
  const box = toWorldBox(parsedBounds, cellSize, borderMargin);
  const budget = normalizeMotherBrainWaveBudget(body?.budget);

  return {
    shardId,
    rawBounds,
    cellSize,
    borderMargin,
    placeInset,
    seed,
    epoch,
    theme,
    count,
    append,
    updateExisting,
    commit,
    parsedBounds,
    box,
    budget,
  };
}
