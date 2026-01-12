// worldcore/world/RegionFlags.ts
/**
 * RegionFlags is a small DB-backed rules lookup for a region.
 *
 * Source of truth:
 *  - Postgres table: regions.flags (jsonb)
 *
 * Design goals:
 *  - Fail-closed: if DB is unavailable, treat flags as empty.
 *  - Small in-memory cache: flags are expected to change rarely.
 *  - RegionId normalization: code often uses "prime_shard:8,8" while DB stores region_id as "8,8".
 *
 * TEST SAFETY:
 *  - Under node --test, NEVER touch Postgres.
 *  - Also do NOT import Database.ts at module load (it can create pools/handles depending on version).
 */

import { Logger } from "../utils/logger";

const log = Logger.scope("REGION_FLAGS");

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
  rules?: Record<string, unknown>;
};

type CacheEntry = { flags: RegionFlags; loadedAtMs: number };
const CACHE = new Map<string, CacheEntry>();

function isNodeTestRuntime(): boolean {
  return (
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.env.NODE_ENV === "test" ||
    process.env.WORLDCORE_TEST === "1"
  );
}

export function normalizeRegionIdForDb(regionId: string): string {
  // Accept:
  // - "prime_shard:8,8" -> "8,8"
  // - "8,8" -> "8,8"
  // - "bandit-fight" -> "bandit-fight" (non-grid named regions are fine)
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
    f.rules = input.rules as Record<string, unknown>;
  }

  return f;
}

export async function getRegionFlags(
  shardId: string,
  regionId: string,
  opts?: { bypassCache?: boolean; ttlMs?: number }
): Promise<RegionFlags> {
  // 🚫 Unit tests must never touch DB.
  if (isNodeTestRuntime()) return {};

  const ttlMs = opts?.ttlMs ?? 60_000;
  const dbRegionId = normalizeRegionIdForDb(regionId);
  const k = key(shardId, dbRegionId);

  const now = Date.now();
  const cached = CACHE.get(k);
  if (!opts?.bypassCache && cached && now - cached.loadedAtMs <= ttlMs) {
    return cached.flags;
  }

  try {
    // Lazy import so DB module is never loaded unless truly needed.
    const { db } = await import("../db/Database");

    const res = await db.query(
      `SELECT flags FROM regions WHERE shard_id = $1 AND region_id = $2`,
      [shardId, dbRegionId]
    );

    const flags = normalizeFlags((res as any).rows?.[0]?.flags ?? {});
    CACHE.set(k, { flags, loadedAtMs: now });
    return flags;
  } catch (err: any) {
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

export function clearRegionFlagsCache(): void {
  CACHE.clear();
}
