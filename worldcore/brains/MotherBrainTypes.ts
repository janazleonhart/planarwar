// worldcore/brains/MotherBrainTypes.ts

import type { DbSpawnPoint } from "../world/SpawnPointService";

/**
 * Snapshot of a spawn point for the strategic planner.
 *
 * This is basically DbSpawnPoint plus optional metadata that
 * higher-level systems can attach.
 */
export type SpawnPointSnapshot = DbSpawnPoint & {
  meta?: Record<string, unknown>;
};

export type SpawnPointType = SpawnPointSnapshot["type"];

/**
 * High-level view of a settlement in a region.
 *
 * For now this is intentionally soft-typed; we only care about
 * identity, location (via regionId + matching spawn point), and
 * faction for v1 planning passes.
 */
export interface SettlementSnapshot {
  /** Logical id, usually equal to spawnId for the town/outpost spawn. */
  id: string;
  kind: "town" | "village" | "outpost" | "hub" | "city" | "camp" | string;
  shardId: string;
  regionId: string | null;
  factionId?: string | null;
  name?: string | null;
  populationTier?: number | null;
  meta?: Record<string, unknown>;
}

/**
 * Aggregated view of a single region cell.
 */
export interface RegionSnapshot {
  /** Region id, e.g. "prime_shard:0,0". */
  id: string;
  shardId: string;

  /** Grid coordinates for this region (from SimGrid / ServerWorldManager). */
  cellX: number;
  cellZ: number;

  /** Effective danger tier (after dynamic bumps/decay). */
  dangerTier: number;

  /** Baseline danger tier (from worldgen/faction control). */
  baseTier: number;

  /** Raw danger score used to derive the tier. */
  dangerScore: number;

  /** All DB spawn points that live in this region. */
  spawnPoints: SpawnPointSnapshot[];

  /** Towns/outposts/etc that conceptually "own" the area. */
  settlements: SettlementSnapshot[];
}

/**
 * Slim view of danger values for a region for brains that only
 * care about risk levels.
 */
export interface RegionDangerSnapshot {
  regionId: string; // matches RegionSnapshot.id
  shardId: string;
  baseTier: number;
  effectiveTier: number;
  score: number;
  lastUpdatedAt?: Date | null;
}

/**
 * Read-only inputs to a single Mother Brain pass.
 */
export interface BrainContext {
  shardId: string;

  /** Regions visible to this brain invocation. */
  regions: RegionSnapshot[];

  /** Optional aggregated danger data (may be derived from regions). */
  regionDanger: RegionDangerSnapshot[];

  /**
   * Wall-clock time for this run; used for time-based decay, TTLs, etc.
   */
  now: Date;
}

export interface BrainActionBase<TKind extends string> {
  kind: TKind;
  /**
   * Optional trace string to aid debugging / logs, e.g. "ResourceBaseline".
   */
  source?: string;
}

/**
 * Upsert (insert or update) a spawn point.
 *
 * This uses the same shape as SimSpawnPoint so we can reuse
 * the existing sim/DB harnesses with minimal glue.
 */
export interface BrainActionUpsertSpawn
  extends BrainActionBase<"upsert_spawn"> {
  spawn: {
    shardId: string;
    spawnId: string;
    type: SpawnPointType;
    protoId: string;
    variantId?: string | null;
    archetype: string;
    x: number;
    y: number;
    z: number;
    regionId: string | null;
    meta?: Record<string, unknown>;
  };
}

/**
 * Delete a spawn point identified by (shardId, spawnId).
 *
 * DB adapters can translate this into a DELETE on spawn_points.
 */
export interface BrainActionDeleteSpawn
  extends BrainActionBase<"delete_spawn"> {
  shardId: string;
  spawnId: string;
}

/**
 * Union of all actions a brain may currently emit.
 *
 * As we add more capabilities we can extend this union.
 */
export type BrainAction =
  | BrainActionUpsertSpawn
  | BrainActionDeleteSpawn;

/**
 * A single planning module. Pure function in, actions out.
 *
 * Modules should be deterministic for a given context (i.e. if they
 * use randomness they should be seeded from data in the context).
 */
export type BrainModule = (ctx: BrainContext) => BrainAction[];

/**
 * Options for a brain run (mostly for the eventual daemon / tools
 * that will orchestrate and apply actions).
 */
export interface BrainRunOptions {
  dryRun?: boolean;
}

/**
 * Basic stats produced after applying a set of actions to the DB.
 *
 * The Mother Brain daemon will track these per-module so we can
 * observe how "noisy" each planner is.
 */
export interface BrainApplyStats {
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
}
