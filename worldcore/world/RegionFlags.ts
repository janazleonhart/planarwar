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
 */

import { db } from "../db/Database";
import { Logger } from "../utils/logger";

const log = Logger.scope("REGION_FLAGS");

export type PvpMode = "open" | "duelOnly" | "warfront";
export type EventKind = "invasion" | "warfront" | "seasonal" | "story";

export type RegionFlags = {
  // PvP
  pvpEnabled?: boolean;
  pvpMode?: PvpMode;

  // Story / seasonal / warfront metadata (optional)
  eventEnabled?: boolean;
  eventId?: string;
  eventKind?: EventKind;
  eventTags?: string[];

  // Optional tuning knobs
  dangerScalar?: number; // multiplies RegionDanger aura strength (default 1)

  // Warfront id (can be redundant with eventId, but useful for explicit warfront hooks)
  warfrontId?: string;

  // Escape hatch for future structured rules
  rules?: Record<string, unknown>;
};


/**
 * Normalize regionId into the DB representation.
 *
 * The simulation commonly uses a combined form like:
 *   "prime_shard:8,8"
 *
 * The DB stores region_id separately (e.g. "8,8").
 */
export function normalizeRegionIdForDb(regionId: string): string {
  if (!regionId) return regionId;
  const idx = regionId.indexOf(":");
  if (idx === -1) return regionId;
  return regionId.slice(idx + 1);
}

type CacheEntry = { flags: RegionFlags; loadedAtMs: number };
const CACHE = new Map<string, CacheEntry>();

function key(shardId: string, dbRegionId: string): string {
  return `${shardId}::${dbRegionId}`;
}

function normalizeFlags(input: any): RegionFlags {
  if (!input || typeof input !== "object") return {};
  const f: RegionFlags = {};

  // PvP
  if (typeof input.pvpEnabled === "boolean") f.pvpEnabled = input.pvpEnabled;
  if (input.pvpMode === "open" || input.pvpMode === "duelOnly" || input.pvpMode === "warfront")
    f.pvpMode = input.pvpMode;

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
    // Clamp to sane bounds; downstream also clamps the resulting damageTakenPct.
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
  const ttlMs = opts?.ttlMs ?? 60_000;

  const dbRegionId = normalizeRegionIdForDb(regionId);
  const k = key(shardId, dbRegionId);

  const now = Date.now();
  const cached = CACHE.get(k);
  if (!opts?.bypassCache && cached && now - cached.loadedAtMs <= ttlMs) {
    return cached.flags;
  }

  try {
    const res = await db.query(
      `SELECT flags FROM regions WHERE shard_id = $1 AND region_id = $2`,
      [shardId, dbRegionId]
    );

    const flags = normalizeFlags(res.rows?.[0]?.flags ?? {});
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
