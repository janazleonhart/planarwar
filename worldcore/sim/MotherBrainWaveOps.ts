// worldcore/sim/MotherBrainWaveOps.ts
// Pure helpers for reasoning about Mother Brain "waves" without touching the DB.

import type { PlaceSpawnAction } from "./MotherBrainWavePlanner";

export type BrainWaveApplyPlan = {
  planned: number;
  uniquePlanned: number;

  /** Count of brain:* spawns that would be deleted in the bounds box (replace-mode). */
  wouldDelete: number;

  /** New spawn_ids not present in DB. */
  wouldInsert: number;

  /** Existing spawn_ids that would be updated (only when updateExisting=true). */
  wouldUpdate: number;

  /** Existing spawn_ids that would be skipped (updateExisting=false). */
  wouldSkip: number;

  /** Duplicate spawn_ids within the planned wave (should be 0; counted defensively). */
  duplicatePlanned: number;
};

export type ComputeBrainWaveApplyPlanArgs = {
  plannedActions: PlaceSpawnAction[];

  /** Existing spawn_ids that already exist in DB (for upsert decisions). */
  existingSpawnIds: Iterable<string>;

  /** Existing brain:* spawn_ids inside the box (for replace-mode deletion count). */
  existingBrainSpawnIdsInBox: Iterable<string>;

  /** If true, we do NOT delete existing brain:* spawns in the box. */
  append: boolean;

  /** If true, we update existing spawn_ids; otherwise we skip them. */
  updateExisting: boolean;
};

export function computeBrainWaveApplyPlan(args: ComputeBrainWaveApplyPlanArgs): BrainWaveApplyPlan {
  const existing = new Set<string>();
  for (const sid of args.existingSpawnIds) existing.add(String(sid));

  let planned = 0;
  let uniquePlanned = 0;
  let duplicatePlanned = 0;

  let wouldInsert = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;

  const seen = new Set<string>();

  for (const a of args.plannedActions ?? []) {
    if (!a || (a as any).kind !== "place_spawn") continue;
    const sid = String((a as any).spawn?.spawnId ?? "");
    if (!sid) continue;

    planned += 1;

    if (seen.has(sid)) {
      duplicatePlanned += 1;
      continue;
    }
    seen.add(sid);
    uniquePlanned += 1;

    const exists = existing.has(sid);
    if (exists) {
      if (args.updateExisting) wouldUpdate += 1;
      else wouldSkip += 1;
    } else {
      wouldInsert += 1;
    }
  }

  let wouldDelete = 0;
  if (!args.append) {
    for (const _ of args.existingBrainSpawnIdsInBox) wouldDelete += 1;
  }

  return {
    planned,
    uniquePlanned,
    wouldDelete,
    wouldInsert,
    wouldUpdate,
    wouldSkip,
    duplicatePlanned,
  };
}

// ---------------------------------------------------------------------------
// Budgets / caps (Mother Brain hardening)
// ---------------------------------------------------------------------------

export type BrainWaveBudgetConfig = {
  /** Clamp total brain:* spawns that may exist within the bounds after the wave. */
  maxTotalInBounds?: number | null;

  /** Clamp total brain:* spawns for this theme within the bounds after the wave. */
  maxThemeInBounds?: number | null;

  /** Clamp total brain:* spawns for this (epoch, theme) within the bounds after the wave. */
  maxEpochThemeInBounds?: number | null;

  /** Clamp the number of NEW inserts attempted in this wave run. */
  maxNewInserts?: number | null;
};

export type BrainWaveBudgetReport = {
  theme: string;
  epoch: number;
  append: boolean;

  caps: Required<BrainWaveBudgetConfig>;

  /** Observed current counts (what exists now in DB). */
  observedExisting: {
    total: number;
    theme: number;
    epochTheme: number;
  };

  /** Effective counts used for budgeting (replace-mode treats existing as 0 because it will be deleted). */
  effectiveExisting: {
    total: number;
    theme: number;
    epochTheme: number;
  };

  /** Allowed NEW inserts by each cap (null means cap not set). */
  allowedBy: {
    total: number | null;
    theme: number | null;
    epochTheme: number | null;
    maxNew: number | null;
  };

  /** Final allowed NEW inserts after taking the minimum across configured caps. */
  allowedNewInserts: number;

  /** Which caps were binding (the ones that set the minimum). */
  limitingCaps: Array<"maxTotalInBounds" | "maxThemeInBounds" | "maxEpochThemeInBounds" | "maxNewInserts">;
};

function asFiniteNonNegInt(n: any): number | null {
  if (n == null) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.floor(v);
  return i >= 0 ? i : null;
}

export function computeBrainWaveBudgetReport(args: {
  existingBrainSpawnIdsInBox: Iterable<string>;
  append: boolean;
  theme: string;
  epoch: number;
  budget?: BrainWaveBudgetConfig | null;
}): BrainWaveBudgetReport {
  const theme = String(args.theme ?? "").trim().toLowerCase() || "(unknown)";
  const epoch = Number.isFinite(Number(args.epoch)) ? Math.floor(Number(args.epoch)) : 0;

  const caps: Required<BrainWaveBudgetConfig> = {
    maxTotalInBounds: asFiniteNonNegInt(args.budget?.maxTotalInBounds),
    maxThemeInBounds: asFiniteNonNegInt(args.budget?.maxThemeInBounds),
    maxEpochThemeInBounds: asFiniteNonNegInt(args.budget?.maxEpochThemeInBounds),
    maxNewInserts: asFiniteNonNegInt(args.budget?.maxNewInserts),
  };

  let obsTotal = 0;
  let obsTheme = 0;
  let obsEpochTheme = 0;

  for (const sid0 of args.existingBrainSpawnIdsInBox) {
    const sid = String(sid0 ?? "");
    if (!sid || !sid.startsWith("brain:")) continue;

    obsTotal += 1;

    const meta = parseBrainSpawnIdLoose(sid);

    const isTheme = meta.theme != null
      ? meta.theme.toLowerCase() === theme
      : meta.tokens.map((t) => t.toLowerCase()).includes(theme);

    if (isTheme) {
      obsTheme += 1;

      const isEpoch = meta.epoch != null
        ? meta.epoch === epoch
        : meta.tokens.some((t) => /^\d+$/.test(t) && Number(t) === epoch);

      if (isEpoch) obsEpochTheme += 1;
    }
  }

  const effTotal = args.append ? obsTotal : 0;
  const effTheme = args.append ? obsTheme : 0;
  const effEpochTheme = args.append ? obsEpochTheme : 0;

  const allowedByTotal = caps.maxTotalInBounds != null ? Math.max(0, caps.maxTotalInBounds - effTotal) : null;
  const allowedByTheme = caps.maxThemeInBounds != null ? Math.max(0, caps.maxThemeInBounds - effTheme) : null;
  const allowedByEpochTheme =
    caps.maxEpochThemeInBounds != null ? Math.max(0, caps.maxEpochThemeInBounds - effEpochTheme) : null;
  const allowedByMaxNew = caps.maxNewInserts != null ? Math.max(0, caps.maxNewInserts) : null;

  const candidates: Array<["maxTotalInBounds" | "maxThemeInBounds" | "maxEpochThemeInBounds" | "maxNewInserts", number]> = [];
  if (allowedByTotal != null) candidates.push(["maxTotalInBounds", allowedByTotal]);
  if (allowedByTheme != null) candidates.push(["maxThemeInBounds", allowedByTheme]);
  if (allowedByEpochTheme != null) candidates.push(["maxEpochThemeInBounds", allowedByEpochTheme]);
  if (allowedByMaxNew != null) candidates.push(["maxNewInserts", allowedByMaxNew]);

  let allowedNewInserts = Number.MAX_SAFE_INTEGER;
  if (candidates.length > 0) {
    allowedNewInserts = Math.min(...candidates.map(([, v]) => v));
  }

  const limitingCaps = candidates
    .filter(([, v]) => v === allowedNewInserts)
    .map(([k]) => k);

  return {
    theme,
    epoch,
    append: Boolean(args.append),
    caps,
    observedExisting: { total: obsTotal, theme: obsTheme, epochTheme: obsEpochTheme },
    effectiveExisting: { total: effTotal, theme: effTheme, epochTheme: effEpochTheme },
    allowedBy: {
      total: allowedByTotal,
      theme: allowedByTheme,
      epochTheme: allowedByEpochTheme,
      maxNew: allowedByMaxNew,
    },
    allowedNewInserts,
    limitingCaps,
  };
}

export type BudgetFilterResult = {
  filteredActions: PlaceSpawnAction[];

  plannedUnique: number;
  keptUnique: number;

  keptInserts: number;
  keptUpdates: number;
  skippedExisting: number;

  droppedDueToBudget: number;
  duplicatePlanned: number;
};

/**
 * Deterministically trims a wave to a budget.
 *
 * - Keeps updates only if updateExisting=true.
 * - Keeps inserts until allowedNewInserts is exhausted.
 * - Drops duplicates.
 */
export function filterPlannedActionsToBudget(args: {
  plannedActions: PlaceSpawnAction[];
  existingSpawnIds: Iterable<string>;
  updateExisting: boolean;
  allowedNewInserts: number;
}): BudgetFilterResult {
  const existing = new Set<string>();
  for (const sid of args.existingSpawnIds) existing.add(String(sid));

  const seen = new Set<string>();
  const filteredActions: PlaceSpawnAction[] = [];

  let plannedUnique = 0;
  let keptUnique = 0;

  let keptInserts = 0;
  let keptUpdates = 0;
  let skippedExisting = 0;

  let droppedDueToBudget = 0;
  let duplicatePlanned = 0;

  let budgetLeft = Math.max(0, Math.floor(args.allowedNewInserts));

  for (const a of args.plannedActions ?? []) {
    if (!a || (a as any).kind !== "place_spawn") continue;
    const sid = String((a as any).spawn?.spawnId ?? "");
    if (!sid) continue;

    if (seen.has(sid)) {
      duplicatePlanned += 1;
      continue;
    }
    seen.add(sid);
    plannedUnique += 1;

    const exists = existing.has(sid);

    if (exists) {
      if (!args.updateExisting) {
        skippedExisting += 1;
        continue;
      }

      filteredActions.push(a);
      keptUnique += 1;
      keptUpdates += 1;
      continue;
    }

    if (budgetLeft <= 0) {
      droppedDueToBudget += 1;
      continue;
    }

    filteredActions.push(a);
    keptUnique += 1;
    keptInserts += 1;
    budgetLeft -= 1;
  }

  return {
    filteredActions,
    plannedUnique,
    keptUnique,
    keptInserts,
    keptUpdates,
    skippedExisting,
    droppedDueToBudget,
    duplicatePlanned,
  };
}

// ---------------------------------------------------------------------------
// Wipe planning (filter by theme/epoch tokens)
// ---------------------------------------------------------------------------

export type BrainSpawnIdMeta = {
  spawnId: string;
  tokens: string[];
  theme: string | null;
  epoch: number | null;
};

/**
 * Loosely parse a brain:* spawnId.
 *
 * We intentionally do NOT lock to a rigid schema.
 * - epoch: first non-negative integer token
 * - theme: first known theme token (defaults to goblins/bandits/rats/ore)
 */
export function parseBrainSpawnIdLoose(spawnId: string, knownThemes?: string[]): BrainSpawnIdMeta {
  const raw = String(spawnId ?? "");
  const parts = raw
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean);

  const tokens = (parts[0] === "brain" ? parts.slice(1) : parts).filter(Boolean);

  let epoch: number | null = null;
  for (const t of tokens) {
    if (!/^\d+$/.test(t)) continue;
    const n = parseInt(t, 10);
    if (Number.isFinite(n) && n >= 0) {
      epoch = n;
      break;
    }
  }

  const themes = (knownThemes ?? ["goblins", "bandits", "rats", "ore"]).map((t) => String(t).toLowerCase());

  let theme: string | null = null;
  for (const t of tokens) {
    const tl = t.toLowerCase();
    if (themes.includes(tl)) {
      theme = tl;
      break;
    }
  }

  return { spawnId: raw, tokens, theme, epoch };
}

export type BrainWipePlan = {
  selected: string[];
  wouldDelete: number;
};

export function computeBrainWipePlan(args: {
  existingBrainSpawnIdsInBox: Iterable<string>;
  theme?: string | null;
  epoch?: number | null;
}): BrainWipePlan {
  const themeQ = (args.theme ?? "").trim().toLowerCase() || null;
  const epochQ = args.epoch != null && Number.isFinite(args.epoch as number) ? (args.epoch as number) : null;

  const selected: string[] = [];

  for (const sid0 of args.existingBrainSpawnIdsInBox) {
    const sid = String(sid0 ?? "");
    if (!sid.startsWith("brain:")) continue;

    const meta = parseBrainSpawnIdLoose(sid);

    if (themeQ) {
      if (meta.theme != null) {
        if (meta.theme !== themeQ) continue;
      } else {
        const tokLower = meta.tokens.map((t) => t.toLowerCase());
        if (!tokLower.includes(themeQ)) continue;
      }
    }

    if (epochQ != null) {
      if (meta.epoch != null) {
        if (meta.epoch !== epochQ) continue;
      } else {
        let found = false;
        for (const t of meta.tokens) {
          if (!/^\d+$/.test(t)) continue;
          const n = parseInt(t, 10);
          if (Number.isFinite(n) && n === epochQ) {
            found = true;
            break;
          }
        }
        if (!found) continue;
      }
    }

    selected.push(sid);
  }

  return { selected, wouldDelete: selected.length };
}
