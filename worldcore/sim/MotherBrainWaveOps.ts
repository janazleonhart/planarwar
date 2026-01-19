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
