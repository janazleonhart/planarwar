// worldcore/world/TownTierRules.ts
// -----------------------------------------------------------------------------
// Purpose:
// Centralize "town tier" rules for world services + (optionally) crafting stations.
//
// v1 goals:
// - Tier 1: rest + mailbox + guards (what we already have in baseline).
// - Higher tiers (2+): define which services *should* exist once service
//   gating + anchors are wired (bank/vendor/auction/guildbank).
//
// Station goals (early, pragmatic):
// - Keep station requirements DB-backed (recipes declare stationKind).
// - Allow planners/tools to *optionally* gate which stations appear by town tier.
// - Do NOT hard-require tier metadata; if we can't infer a tier, callers can
//   choose to skip tier gating.
//
// This file is intentionally pure/data-only so multiple systems can depend on
// it (simBrain planners, TownBaselines, future faction AI, tools) without
// pulling in DB or engine code.
// -----------------------------------------------------------------------------

import type { DbSpawnPoint } from "./SpawnPointService";

export type TownTierId = 1 | 2 | 3 | 4 | 5;

export type TownServiceId =
  | "mailbox"
  | "rest"
  | "guards"
  | "bank"
  | "vendor"
  | "auction"
  | "guildbank";

// -----------------------------------------------------------------------------
// Vendor economy defaults by town tier
// -----------------------------------------------------------------------------
//
// Economy Realism v1.1 introduces restock cadence and tier-aware defaults.
// We keep the policy here so tools + services can share the same intent.
//
// IMPORTANT:
// - These values are applied ONLY when economy rows are first created for a
//   vendor's items (best-effort insert). Existing rows are not overwritten.
// - "Per-town" in v1.1 is implemented as "per-vendor-id" defaults, where the
//   vendor id can include a tier token (e.g. "starter_alchemist_tier3").
//   If no token exists, we treat it as tier 1.
// -----------------------------------------------------------------------------

export interface VendorEconomyTierPolicy {
  tier: TownTierId;

  /** Maximum stock to restock up to (<=0 means infinite, but we keep it >0 by default). */
  stockMax: number;

  /** Cadence: every N seconds, add restockAmount units. */
  restockEverySec: number;
  restockAmount: number;

  /** Dynamic pricing bounds (see computeVendorUnitPriceGold). */
  priceMinMult: number;
  priceMaxMult: number;

  /** Optional text for humans. */
  notes?: string;
}

const VENDOR_ECONOMY_TIER_POLICY: Record<TownTierId, VendorEconomyTierPolicy> = {
  1: {
    tier: 1,
    stockMax: 25,
    restockEverySec: 300,
    restockAmount: 1,
    priceMinMult: 0.90,
    priceMaxMult: 1.60,
    notes: "Small outpost: low stock, slower restock, harsher scarcity.",
  },
  2: {
    tier: 2,
    stockMax: 40,
    restockEverySec: 240,
    restockAmount: 1,
    priceMinMult: 0.88,
    priceMaxMult: 1.55,
    notes: "Market hamlet: modest stock and cadence.",
  },
  3: {
    tier: 3,
    stockMax: 60,
    restockEverySec: 180,
    restockAmount: 2,
    priceMinMult: 0.85,
    priceMaxMult: 1.50,
    notes: "Town: better supply chain.",
  },
  4: {
    tier: 4,
    stockMax: 90,
    restockEverySec: 150,
    restockAmount: 3,
    priceMinMult: 0.82,
    priceMaxMult: 1.45,
    notes: "Trade hub: robust restock.",
  },
  5: {
    tier: 5,
    stockMax: 120,
    restockEverySec: 120,
    restockAmount: 4,
    priceMinMult: 0.80,
    priceMaxMult: 1.40,
    notes: "Capital: deep inventory and fast restock.",
  },
};

/** Get the vendor economy defaults for a town tier (clamps tier to [1..5]). */
export function getVendorEconomyPolicyForTier(tier: number): VendorEconomyTierPolicy {
  const t = clampTier(tier);
  return { ...(VENDOR_ECONOMY_TIER_POLICY[t] ?? VENDOR_ECONOMY_TIER_POLICY[1]) };
}

/** Try to infer a town tier token (tier_3, tier-3, etc.) from an arbitrary id string. */
export function tryInferTownTierFromIdToken(id: string | null | undefined): TownTierId | null {
  const s = String(id ?? "");
  const m = /tier[_-]?(\d+)/i.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  return clampTier(n);
}

/**
 * Station proto ids (spawn_points.protoId for type="station").
 *
 * NOTE:
 * - 'station_campfire' is intentionally listed even though it's usually a
 *   wilderness / player-placed station (not town-seeded).
 */
export type TownStationProtoId =
  | "station_forge"
  | "station_alchemy"
  | "station_oven"
  | "station_mill"
  | "station_campfire";

export interface TownTierRule {
  tier: TownTierId;
  services: TownServiceId[];
  notes?: string;
}

// -----------------------------------------------------------------------------
// Hard-coded default service rules.
// These are the "design intent"; actual enforcement happens elsewhere.
// -----------------------------------------------------------------------------

const TOWN_TIER_RULES: TownTierRule[] = [
  {
    tier: 1,
    services: ["mailbox", "rest", "guards"],
    notes: "Starter hub / small outpost. Minimal safe services only.",
  },
  {
    tier: 2,
    services: ["mailbox", "rest", "guards", "vendor"],
    notes: "Market hamlet. Adds basic vendor anchor once gating exists.",
  },
  {
    tier: 3,
    services: ["mailbox", "rest", "guards", "vendor", "bank"],
    notes: "Regional town. Bank service becomes available.",
  },
  {
    tier: 4,
    services: ["mailbox", "rest", "guards", "vendor", "bank", "auction"],
    notes: "Trade hub. Auction house unlocks.",
  },
  {
    tier: 5,
    services: [
      "mailbox",
      "rest",
      "guards",
      "vendor",
      "bank",
      "auction",
      "guildbank",
    ],
    notes: "Major capital / faction seat. Full services, including guild bank.",
  },
];

// -----------------------------------------------------------------------------
// Station rules (optional)
// -----------------------------------------------------------------------------
//
// These are intentionally conservative: Tier 1 towns don't get heavy stations.
// If a caller can't infer a tier, it can choose to NOT apply station gating.
//
// Default intent:
// - Tier 1: none (campfire is generally not a town-seeded station)
// - Tier 2: oven + mill (food loop)
// - Tier 3: forge (basic metal loop)
// - Tier 4: alchemy (pots/consumables)
// - Tier 5: all
//
// You can still force any station anywhere by:
///  - bypassing this module, or
//   - skipping gating when tier is unknown.
// -----------------------------------------------------------------------------

const TOWN_STATION_RULES: Record<TownTierId, TownStationProtoId[]> = {
  1: [],
  2: ["station_oven", "station_mill"],
  3: ["station_oven", "station_mill", "station_forge"],
  4: ["station_oven", "station_mill", "station_forge", "station_alchemy"],
  5: ["station_oven", "station_mill", "station_forge", "station_alchemy"],
};

function clampTier(n: number): TownTierId {
  const t = Math.max(1, Math.min(5, Math.floor(n || 1)));
  return t as TownTierId;
}

/**
 * Get the canonical rule entry for a given tier.
 * If out of range, clamps into [1,5].
 */
export function getTownTierRule(tier: number): TownTierRule {
  const clamped = clampTier(tier);
  const found = TOWN_TIER_RULES.find((r) => r.tier === clamped);
  return found ?? TOWN_TIER_RULES[0];
}

/**
 * Convenience: get just the service ids for a tier.
 */
export function getServicesForTier(tier: number): TownServiceId[] {
  return [...getTownTierRule(tier).services];
}

/**
 * Convenience: get the intended station proto ids for a tier.
 */
export function getStationProtoIdsForTier(tier: number): TownStationProtoId[] {
  const t = clampTier(tier);
  return [...(TOWN_STATION_RULES[t] ?? [])];
}

// -----------------------------------------------------------------------------
// Tier inference helpers
// -----------------------------------------------------------------------------
//
// We do NOT add a DB column yet. Instead, we infer from naming conventions:
//
// - spawn.variantId like "town_tier2_default"
// - spawn.spawnId like "town_tier3_whatever"
// - archetype containing "tier_4" or "tier-4"
//
// If nothing is found, inferTownTierFromSpawn defaults to Tier 1.
// If you need a "tier is unknown" signal, use tryInferTownTierFromSpawn().
// -----------------------------------------------------------------------------

type Spawnish = Pick<DbSpawnPoint, "spawnId" | "archetype" | "variantId" | "townTier"> & {
  // Optional future metadata from tools/worldgen; we don't rely on it yet.
  tags?: string[] | null;
};

function tryParseTierToken(s: string | null | undefined): TownTierId | null {
  if (!s) return null;
  const m = /tier[_-]?(\d+)/i.exec(String(s));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return clampTier(n);
}

/**
 * Returns the town tier if explicitly provided (DB column `town_tier`),
 * otherwise attempts to infer it from a tier token (e.g. `tier_3`) in spawn metadata.
 * Returns null if no tier information is present.
 */
export function tryInferTownTierFromSpawn(spawn: Spawnish): TownTierId | null {
  // Option B (authoritative): DB-backed town tier (spawn_points.town_tier) wins.
  const explicit = spawn.townTier;
  if (explicit !== null && explicit !== undefined) {
    const n = typeof explicit === "number" ? explicit : parseInt(String(explicit), 10);
    if (Number.isFinite(n)) return clampTier(n);
  }

  const candidates: (string | null | undefined)[] = [
    spawn.variantId,
    spawn.spawnId,
    spawn.archetype,
  ];

  const tags = spawn.tags;
  if (Array.isArray(tags)) {
    for (const t of tags) candidates.push(String(t));
  }

  for (const c of candidates) {
    const tier = tryParseTierToken(c);
    if (tier) return tier;
  }

  return null;
}

/**
 * Infer a town's tier from its spawn metadata.
 *
 * v1 behavior:
 * - look at variantId, spawnId, archetype, then tags
 * - if any contain "tierX", use that X
 * - else fall back to Tier 1
 */
export function inferTownTierFromSpawn(spawn: Spawnish): TownTierId {
  return tryInferTownTierFromSpawn(spawn) ?? 1;
}

/**
 * Get the *intended* service set for a given town spawn.
 *
 * This does NOT spawn anything; it just tells other systems
 * what should exist for this town's tier.
 */
export function getServicesForTownSpawn(spawn: Spawnish): TownServiceId[] {
  const tier = inferTownTierFromSpawn(spawn);
  return getServicesForTier(tier);
}

/**
 * Get the *intended* station proto ids for a given town spawn.
 *
 * If the town tier is unknown (no tier token), we return null so callers
 * can decide whether to skip gating or force a default.
 */
export function getStationProtoIdsForTownSpawn(
  spawn: Spawnish,
): TownStationProtoId[] | null {
  const tier = tryInferTownTierFromSpawn(spawn);
  if (!tier) return null;
  return getStationProtoIdsForTier(tier);
}
