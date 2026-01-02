// worldcore/world/TownTierRules.ts
// -----------------------------------------------------------------------------
// Purpose:
// Centralize "town tier" rules for world services.
//
// v1 goals:
// - Tier 1: rest + mailbox + guards (what we already have in baseline).
// - Higher tiers (2+): define which services *should* exist once service
//   gating + anchors are wired (bank/vendor/auction/guildbank).
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

export interface TownTierRule {
  tier: TownTierId;
  services: TownServiceId[];
  notes?: string;
}

// -----------------------------------------------------------------------------
// Hard-coded default rules.
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

// -----------------------------------------------------------------------------
// Tier inference helpers
// -----------------------------------------------------------------------------
//
// We do NOT add a DB column yet. Instead, we infer from naming conventions:
//
// - spawn.variantId like "town_tier2_default"
// - spawn.spawnId like "town_tier3_whatever"
// - archetype or tags containing "tier_4" or "tier-4"
//
// If nothing is found, default to Tier 1.
// -----------------------------------------------------------------------------

type Spawnish = Pick<DbSpawnPoint, "spawnId" | "archetype" | "variantId"> & {
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
 * Infer a town's tier from its spawn metadata.
 *
 * v1 behavior:
 * - look at variantId, spawnId, archetype, then tags
 * - if any contain "tierX", use that X
 * - else fall back to Tier 1
 */
export function inferTownTierFromSpawn(spawn: Spawnish): TownTierId {
  const candidates: (string | null | undefined)[] = [
    spawn.variantId,
    spawn.spawnId,
    spawn.archetype,
  ];

  const tags = (spawn as any).tags;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      candidates.push(String(t));
    }
  }

  for (const c of candidates) {
    const tier = tryParseTierToken(c);
    if (tier) return tier;
  }

  return 1;
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
