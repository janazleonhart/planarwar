// worldcore/world/RegionFlags.ts
/**
 * RegionFlags is a small rules lookup for a region.
 *
 * Source of truth (runtime):
 * - Postgres table: regions.flags (jsonb)
 *
 * Design goals:
 * - Safe in unit tests: never touch DB/Redis
 * - Lazy DB import: Database.ts must not load at module import time
 * - Small in-memory cache: flags change rarely
 * - RegionId normalization: code often uses "prime_shard:8,8" while DB stores "8,8"
 *
 * Lane B:
 * - Injectable provider (DB vs static) so tests can stub safely without Postgres.
 */

import { Logger } from "../utils/logger";

const log = Logger.scope("REGION_FLAGS");

// -----------------------------
// Types
// -----------------------------
export type RegionPvpMode = "open" | "duelOnly" | "warfront";
export type RegionEventKind = "invasion" | "warfront" | "seasonal" | "story";

export type RegionFlags = {
  // Combat rails
  combatEnabled?: boolean;

  // PvP
  pvpEnabled?: boolean;
  pvpMode?: RegionPvpMode;

  // Event metadata
  eventEnabled?: boolean;
  eventId?: string;
  eventKind?: RegionEventKind;
  eventTags?: string[];

  // Optional tuning knobs
  dangerScalar?: number;

  // Warfront explicit id
  warfrontId?: string;

  // Escape hatch for future ad-hoc rules
  rules?: Record<string, any>;
};

export type RegionFlagsOverrides = Record<string, Record<string, RegionFlags>>;
// shape: { [shardId]: { [regionId]: flags } }

export interface RegionFlagsProvider {
  /**
   * Fetch flags for a region.
   * The regionId provided here is already normalized for DB use (no shard prefix).
   * Implementations can fail/throw; RegionFlags will fail-closed to {}.
   */
  getFlags(shardId: string, dbRegionId: string): Promise<unknown>;
}

// -----------------------------
// Runtime detection
// -----------------------------
function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

// -----------------------------
// Normalization & cache
// -----------------------------
type CacheEntry = { flags: RegionFlags; loadedAtMs: number };
const CACHE = new Map<string, CacheEntry>();

export function normalizeRegionIdForDb(regionId: string): string {
  // Accept:
  // - "prime_shard:8,8" -> "8,8"
  // - "8,8" -> "8,8"
  // - "bandit-fight" -> "bandit-fight" (named regions)
  const s = String(regionId ?? "").trim();
  const idx = s.indexOf(":");
  if (idx >= 0) return s.slice(idx + 1);
  return s;
}

function key(shardId: string, dbRegionId: string): string {
  return `${shardId}::${dbRegionId}`;
}

function normalizeFlags(input: any): RegionFlags {
  if (!input || typeof input !== "object") return {};

  const f: RegionFlags = {};

  // Combat rails
  if (typeof input.combatEnabled === "boolean") f.combatEnabled = input.combatEnabled;

  // PvP
  if (typeof input.pvpEnabled === "boolean") f.pvpEnabled = input.pvpEnabled;
  if (input.pvpMode === "open" || input.pvpMode === "duelOnly" || input.pvpMode === "warfront") {
    f.pvpMode = input.pvpMode;
  }

  // Event metadata
  if (typeof input.eventEnabled === "boolean") f.eventEnabled = input.eventEnabled;
  if (typeof input.eventId === "string") f.eventId = input.eventId;

  if (
    input.eventKind === "invasion" ||
    input.eventKind === "warfront" ||
    input.eventKind === "seasonal" ||
    input.eventKind === "story"
  ) {
    f.eventKind = input.eventKind;
  }

  if (Array.isArray(input.eventTags)) {
    f.eventTags = input.eventTags.filter((x: any) => typeof x === "string");
  }

  // Optional tuning knobs
  if (typeof input.dangerScalar === "number" && Number.isFinite(input.dangerScalar)) {
    const clamped = Math.max(0.1, Math.min(10, input.dangerScalar));
    f.dangerScalar = clamped;
  }

  // Warfront explicit id
  if (typeof input.warfrontId === "string") f.warfrontId = input.warfrontId;

  // Escape hatch
  if (input.rules && typeof input.rules === "object") {
    f.rules = input.rules as Record<string, any>;
  }

  return f;
}

export function clearRegionFlagsCache(): void {
  CACHE.clear();
}

// -----------------------------
// Providers
// -----------------------------
class DbRegionFlagsProvider implements RegionFlagsProvider {
  async getFlags(shardId: string, dbRegionId: string): Promise<unknown> {
    // Lazy import so Database.ts is never loaded unless truly needed.
    const { db } = await import("../db/Database");

    const res = await db.query(
      `SELECT flags
         FROM regions
        WHERE shard_id = $1 AND region_id = $2`,
      [shardId, dbRegionId],
    );

    return (res as any).rows?.[0]?.flags ?? {};
  }
}

let TEST_OVERRIDES: RegionFlagsOverrides | null = null;

class StaticRegionFlagsProvider implements RegionFlagsProvider {
  async getFlags(shardId: string, dbRegionId: string): Promise<unknown> {
    if (!TEST_OVERRIDES) return {};
    const byShard = TEST_OVERRIDES[shardId];
    if (!byShard) return {};

    // allow override keys to be either "prime_shard:0,0" or "0,0"
    const direct = byShard[dbRegionId];
    if (direct) return direct;

    // If someone stored with shard prefix by mistake, still try to find it.
    const withShardPrefix = byShard[`${shardId}:${dbRegionId}`];
    if (withShardPrefix) return withShardPrefix;

    return {};
  }
}

const DB_PROVIDER = new DbRegionFlagsProvider();
const STATIC_PROVIDER = new StaticRegionFlagsProvider();

let OVERRIDE_PROVIDER: RegionFlagsProvider | null = null;

function getActiveProvider(): RegionFlagsProvider {
  if (OVERRIDE_PROVIDER) return OVERRIDE_PROVIDER;
  return isNodeTestRuntime() ? STATIC_PROVIDER : DB_PROVIDER;
}

/**
 * Force a provider (primarily for tests or special tooling).
 * Pass null to restore default provider selection.
 */
export function setRegionFlagsProvider(provider: RegionFlagsProvider | null): void {
  OVERRIDE_PROVIDER = provider;
  clearRegionFlagsCache();
}

/**
 * In-memory overrides (unit tests / offline dev).
 * Shape: { [shardId]: { [regionId]: flags } }
 *
 * NOTE: Setting overrides clears cache for determinism.
 */
export function setRegionFlagsTestOverrides(overrides: RegionFlagsOverrides | null): void {
  TEST_OVERRIDES = overrides;
  clearRegionFlagsCache();
}

// -----------------------------
// Public API
// -----------------------------
export async function getRegionFlags(
  shardId: string,
  regionId: string,
  opts?: { bypassCache?: boolean; ttlMs?: number },
): Promise<RegionFlags> {
  const ttlMs = opts?.ttlMs ?? 60_000;
  const dbRegionId = normalizeRegionIdForDb(regionId);
  const k = key(shardId, dbRegionId);
  const now = Date.now();

  const cached = CACHE.get(k);
  if (!opts?.bypassCache && cached && now - cached.loadedAtMs <= ttlMs) {
    return cached.flags;
  }

  try {
    const provider = getActiveProvider();

    // If someone tries to force DB provider in unit tests, fail fast.
    if (isNodeTestRuntime() && provider === DB_PROVIDER) {
      throw new Error(
        "DbRegionFlagsProvider is not allowed under WORLDCORE_TEST=1 / node --test. Use setRegionFlagsTestOverrides(...) or a static provider.",
      );
    }

    const raw = await provider.getFlags(shardId, dbRegionId);
    const flags = normalizeFlags(raw);

    CACHE.set(k, { flags, loadedAtMs: now });
    return flags;
  } catch (err: any) {
    // Fail-closed: empty flags.
    log.warn("Failed to load region flags; defaulting to {}", {
      shardId,
      dbRegionId,
      err: err?.message ?? String(err),
    });
    return {};
  }
}

export async function isPvpEnabledForRegion(shardId: string, regionId: string): Promise<boolean> {
  const flags = await getRegionFlags(shardId, regionId);
  return !!flags.pvpEnabled;
}

export async function isCombatEnabledForRegion(shardId: string, regionId: string): Promise<boolean> {
  const flags = await getRegionFlags(shardId, regionId);
  // Default allow if unset; only explicit false disables combat.
  return flags.combatEnabled !== false;
}

export async function isEventEnabledForRegion(shardId: string, regionId: string): Promise<boolean> {
  const flags = await getRegionFlags(shardId, regionId);
  return !!flags.eventEnabled;
}

export async function getDangerScalarForRegion(shardId: string, regionId: string): Promise<number> {
  const flags = await getRegionFlags(shardId, regionId);
  const s = flags.dangerScalar;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 1;
}
