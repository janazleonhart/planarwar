// worldcore/sim/ResourceBaselineModule.ts
//
// Deterministic baseline resource planner for Mother Brain v0.1.
// This lives in `worldcore` so both tools (simBrain, resourceBaseline)
// and the future motherbrain daemon can share the same logic.

import { SimRng } from "./SimRng";
import type { PlaceSpawnAction } from "./BrainActions";

export type ResourceKind =
  | "herb"
  | "ore"
  | "stone"
  | "wood"
  | "fish"
  | "grain"
  | "mana";

export interface ResourcePrototypeConfig {
  /** Logical kind – used for summaries / future rules. */
  kind: ResourceKind;
  /** spawn_points.type – coarse category used by systems (e.g. "resource"). */
  type: string;
  /** spawn_points.archetype – more specific node type (e.g. "herb_node"). */
  archetype: string;
  /** spawn_points.proto_id – item or node prototype id (e.g. "herb_peacebloom"). */
  protoId: string;
  /** spawn_points.variant_id – used for quick filtering / uniqueness. */
  variantId: string;

  /** Baseline nodes per region at baseTier (usually tier 1). */
  perSafeRegion: number;
  /** Extra nodes per *settlement* in the region (town, outpost, etc.). */
  perTown: number;
  /** Extra nodes per tier above baseTier (danger scaling). */
  perDangerTier: number;
}

export interface RegionSpawnSnapshot {
  spawnId: string;
  type: string;
  archetype: string | null;
  protoId: string | null;
  variantId: string | null;
  x: number;
  z: number;
}

export interface SettlementSnapshot {
  id: string;
  kind: string; // "town", "outpost", etc. – free-form for now
  x: number;
  z: number;
}

export interface RegionSnapshot {
  regionId: string; // e.g. "prime_shard:0,0"
  shardId: string;
  cellX: number;
  cellZ: number;

  /** Static base tier from region design. */
  baseTier: number;
  /** Effective tier including dynamic danger (for now usually == baseTier). */
  dangerTier: number;
  /** Optional score for debugging; not used directly by this module yet. */
  dangerScore?: number;

  /** All existing spawn points inside this region. */
  spawns: RegionSpawnSnapshot[];

  /** Settlements inside this region (towns, outposts, hubs, etc.). */
  settlements: SettlementSnapshot[];
}

export interface ResourceBaselineConfig {
  /** World cell size in world units (must match ServerWorldManager grid). */
  cellSize: number;
  /** RNG seed for deterministic placement. */
  seed: string;
  /** Per-resource configuration. */
  resources: ResourcePrototypeConfig[];
}

/** Per-resource summary for one region. */
export interface RegionResourceSummary {
  kind: ResourceKind;
  target: number;
  existing: number;
  placed: number;
}

/** Summary per region. */
export interface RegionBaselineSummary {
  regionId: string;
  totalPlaced: number;
  perResource: RegionResourceSummary[];
}

/** Output for a single region. */
export interface RegionBaselinePlan {
  region: RegionSnapshot;
  actions: PlaceSpawnAction[];
  summary: RegionBaselineSummary;
}

/** World-scale output; actions can be fed directly to DB helpers. */
export interface WorldBaselinePlan {
  actions: PlaceSpawnAction[];
  regions: RegionBaselineSummary[];
}

/**
 * Compute how many nodes of a given resource we *want* in this region.
 * This combines:
 *   - a flat baseline (perSafeRegion)
 *   - a bonus per settlement
 *   - a bonus per danger tier above the base tier
 */
export function computeTargetNodesForRegion(
  region: RegionSnapshot,
  res: ResourcePrototypeConfig
): number {
  const safeBase = Math.max(0, res.perSafeRegion);
  const townBonus = Math.max(0, res.perTown) * region.settlements.length;
  const tierDelta = Math.max(0, region.dangerTier - region.baseTier);
  const dangerBonus = Math.max(0, res.perDangerTier) * tierDelta;

  return safeBase + townBonus + dangerBonus;
}

/**
 * Count existing nodes in the region that match this resource prototype.
 * We use (type, variantId) as the identity; protoId is useful but optional.
 */
export function countExistingNodes(
  region: RegionSnapshot,
  res: ResourcePrototypeConfig
): number {
  return region.spawns.filter(
    (s) =>
      s.type === res.type &&
      (s.variantId ?? s.protoId) === res.variantId
  ).length;
}

/**
 * Pick a deterministic "center" for placement:
 *   - If the region has at least one settlement, use the first one.
 *   - Otherwise, use the geometric center of the cell.
 */
function getRegionCenter(region: RegionSnapshot, cellSize: number): { x: number; z: number } {
  if (region.settlements.length > 0) {
    const first = region.settlements[0];
    return { x: first.x, z: first.z };
  }

  const cx = region.cellX;
  const cz = region.cellZ;
  const centerX = (cx + 0.5) * cellSize;
  const centerZ = (cz + 0.5) * cellSize;
  return { x: centerX, z: centerZ };
}

/**
 * Deterministically pick a position for a given "slot" of a resource.
 * We keep nodes inside the region cell, loosely arranged on a noisy ring.
 */
function pickResourcePosition(
  region: RegionSnapshot,
  cellSize: number,
  slotIndex: number,
  totalSlotsForKind: number,
  res: ResourcePrototypeConfig,
  rng: SimRng
): { x: number; z: number } {
  const { x: cx, z: cz } = getRegionCenter(region, cellSize);

  const baseRadius = cellSize * 0.25;
  const jitterRadius = cellSize * 0.15;

  // Spread kinds evenly by giving each kind its own phase offset.
  const kindPhase = kindPhaseOffset(res.kind);

  const angle =
    kindPhase + (2 * Math.PI * slotIndex) / Math.max(1, totalSlotsForKind);

  const radius = baseRadius + rng.next() * jitterRadius;

  const x = cx + Math.cos(angle) * radius;
  const z = cz + Math.sin(angle) * radius;

  return { x, z };
}

/**
 * Small deterministic phase offset per resource kind,
 * just to avoid perfect overlap between types.
 */
function kindPhaseOffset(kind: ResourceKind): number {
  switch (kind) {
    case "herb":
      return 0;
    case "ore":
      return Math.PI / 3;
    case "stone":
      return (2 * Math.PI) / 3;
    case "wood":
      return Math.PI;
    case "fish":
      return (4 * Math.PI) / 3;
    case "grain":
      return (5 * Math.PI) / 3;
    case "mana":
    default:
      return Math.PI / 2;
  }
}

/**
 * Generate a spawn_id that:
 *   - is deterministic
 *   - stays within a safe character set
 *   - is reasonably short yet unique per region
 */
export function makeResourceSpawnId(
  region: RegionSnapshot,
  res: ResourcePrototypeConfig,
  index: number
): string {
  const cx = region.cellX;
  const cz = region.cellZ;
  const kindSlug = res.kind.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  return `res_${kindSlug}_${cx}_${cz}_${index}`;
}

/**
 * Plan baseline resource nodes for a single region.
 */
export function planResourceBaselineForRegion(
  region: RegionSnapshot,
  cfg: ResourceBaselineConfig
): RegionBaselinePlan {
  const rng = new SimRng(`${cfg.seed}:${region.regionId}`);

  const summaries: RegionResourceSummary[] = [];
  const actions: PlaceSpawnAction[] = [];

  for (const res of cfg.resources) {
    const target = computeTargetNodesForRegion(region, res);
    const existing = countExistingNodes(region, res);
    const toPlace = Math.max(0, target - existing);

    if (toPlace <= 0) {
      summaries.push({
        kind: res.kind,
        target,
        existing,
        placed: 0,
      });
      continue;
    }

    const totalSlotsForKind = existing + toPlace;

    for (let i = 0; i < toPlace; i++) {
      const slotIndex = existing + i;
      const { x, z } = pickResourcePosition(
        region,
        cfg.cellSize,
        slotIndex,
        totalSlotsForKind,
        res,
        rng
      );

      const spawnId = makeResourceSpawnId(region, res, slotIndex);

      actions.push({
        kind: "place_spawn",
        spawn: {
          shardId: region.shardId,
          spawnId,
          type: res.type,
          archetype: res.archetype,
          protoId: res.protoId,
          variantId: res.variantId,
          x,
          y: 0,
          z,
          regionId: region.regionId,
        },
      });
    }

    summaries.push({
      kind: res.kind,
      target,
      existing,
      placed: toPlace,
    });
  }

  const totalPlaced = summaries.reduce((sum, s) => sum + s.placed, 0);

  return {
    region,
    actions,
    summary: {
      regionId: region.regionId,
      totalPlaced,
      perResource: summaries,
    },
  };
}

/**
 * Plan resources for all provided regions and flatten the actions.
 */
export function planResourceBaselinesForWorld(
  regions: RegionSnapshot[],
  cfg: ResourceBaselineConfig
): WorldBaselinePlan {
  const regionSummaries: RegionBaselineSummary[] = [];
  const allActions: PlaceSpawnAction[] = [];

  for (const region of regions) {
    const plan = planResourceBaselineForRegion(region, cfg);
    regionSummaries.push(plan.summary);
    allActions.push(...plan.actions);
  }

  return {
    actions: allActions,
    regions: regionSummaries,
  };
}

/**
 * Convenience helper for tools/tests:
 * build a very small "default" config using the canonical
 * gathering resources we keep talking about.
 */
export function buildDefaultResourceConfig(
  seed = "RESOURCE_BASELINE_TEST"
): ResourceBaselineConfig {
  const resources: ResourcePrototypeConfig[] = [
    {
      kind: "herb",
      type: "resource",
      archetype: "herb_node",
      protoId: "herb_peacebloom",
      variantId: "herb_peacebloom",
      perSafeRegion: 1,
      perTown: 1,
      perDangerTier: 1,
    },
    {
      kind: "ore",
      type: "resource",
      archetype: "ore_node",
      protoId: "ore_iron_hematite",
      variantId: "ore_iron_hematite",
      perSafeRegion: 1,
      perTown: 1,
      perDangerTier: 1,
    },
    {
      kind: "stone",
      type: "resource",
      archetype: "stone_node",
      protoId: "stone_granite",
      variantId: "stone_granite",
      perSafeRegion: 1,
      perTown: 1,
      perDangerTier: 0,
    },
    {
      kind: "wood",
      type: "resource",
      archetype: "wood_node",
      protoId: "wood_oak",
      variantId: "wood_oak",
      perSafeRegion: 1,
      perTown: 1,
      perDangerTier: 0,
    },
    {
      kind: "fish",
      type: "resource",
      archetype: "fish_node",
      protoId: "fish_river_trout",
      variantId: "fish_river_trout",
      perSafeRegion: 1,
      perTown: 0,
      perDangerTier: 1,
    },
    {
      kind: "grain",
      type: "resource",
      archetype: "grain_node",
      protoId: "grain_wheat",
      variantId: "grain_wheat",
      perSafeRegion: 1,
      perTown: 1,
      perDangerTier: 0,
    },
    {
      kind: "mana",
      type: "resource",
      archetype: "mana_node",
      protoId: "mana_spark_arcane",
      variantId: "mana_spark_arcane",
      perSafeRegion: 1,
      perTown: 0,
      perDangerTier: 2,
    },
  ];

  return {
    cellSize: 64,
    seed,
    resources,
  };
}
