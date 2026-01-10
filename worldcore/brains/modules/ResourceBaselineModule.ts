// worldcore/brains/modules/ResourceBaselineModule.ts

import type {
  BrainAction,
  BrainActionUpsertSpawn,
  BrainContext,
  BrainModule,
  RegionSnapshot,
  SettlementSnapshot,
  SpawnPointSnapshot,
} from "../MotherBrainTypes";

/**
 * v0 Resource Baseline module
 *
 * Goal:
 *   Ensure each settled region has a minimum number of ore nodes
 *   (ore_vein_small) placed near its towns/outposts, scaled by
 *   danger tier.
 *
 * This doesn't talk to the DB directly; it purely emits
 * upsert_spawn actions. A harness (simBrain, Mother Brain daemon,
 * or a dedicated tool) will be responsible for applying them.
 */

const ORE_ARCHETYPE = "resource_ore";
const ORE_PROTO_ID = "ore_vein_small";

/**
 * Simple helper to decide whether a spawn is an ore resource node.
 */
function isOreSpawn(sp: SpawnPointSnapshot): boolean {
  const t = String(sp.type || "").toLowerCase();
  const arch = String(sp.archetype || "").toLowerCase();
  const proto = String(sp.protoId || "").toLowerCase();

  const looksLikeNode = t === "node" || t === "resource";
  const looksLikeOre =
    arch === ORE_ARCHETYPE ||
    proto === ORE_PROTO_ID ||
    arch.startsWith("resource_ore");

  return looksLikeNode && looksLikeOre;
}

/**
 * How many ore nodes should this region want, in total,
 * assuming the planner can find anchor positions.
 *
 * We scale by:
 *  - number of settlements (towns/outposts/etc)
 *  - danger tier (more dangerous → more rewarding)
 */
function getTargetOreCount(region: RegionSnapshot): number {
  const settlements = Math.max(region.settlements.length, 1);

  // Clamp tiers to something sane
  const tier = Math.max(1, Math.min(5, Math.floor(region.dangerTier || 1)));

  // Per-settlement baselines by tier
  const perSettlement =
    tier === 1
      ? 2
      : tier === 2
      ? 3
      : tier === 3
      ? 4
      : tier === 4
      ? 5
      : 6; // tier 5+

  return settlements * perSettlement;
}

/**
 * Return ore nodes that already exist in this region.
 */
function getExistingOreSpawns(region: RegionSnapshot): SpawnPointSnapshot[] {
  return region.spawnPoints.filter(isOreSpawn);
}

/**
 * Use settlements (and their backing spawn points) as anchors for
 * placing ore nodes. If we can't find any, fall back to *any*
 * spawn points in the region so the world isn't barren.
 */
function getAnchors(
  region: RegionSnapshot,
): { settlement: SettlementSnapshot; spawn: SpawnPointSnapshot }[] {
  const anchors: { settlement: SettlementSnapshot; spawn: SpawnPointSnapshot }[] =
    [];

  const spawnById = new Map<string, SpawnPointSnapshot>();
  for (const sp of region.spawnPoints) {
    spawnById.set(sp.spawnId, sp);
  }

  for (const s of region.settlements) {
    const sp = spawnById.get(s.id);
    if (!sp) continue;
    anchors.push({ settlement: s, spawn: sp });
  }

  if (anchors.length > 0) {
    return anchors;
  }

  // Fallback: use any spawn points as anchors (townless wilderness)
  for (const sp of region.spawnPoints) {
    anchors.push({
      settlement: {
        id: sp.spawnId,
        kind: "camp",
        shardId: region.shardId,
        regionId: region.id,
        name: "Wilderness",
      },
      spawn: sp,
    });
  }

  return anchors;
}

/**
 * Sanitize region ids into a safe slug for spawnId prefixes.
 */
function slugRegionId(regionId: string): string {
  return regionId.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Find the next numeric index suffix to use for ore spawnIds
 * so we don't collide with existing ones.
 */
function nextOreIndex(region: RegionSnapshot, slug: string): number {
  const prefix = `ore_${slug}_`;
  let maxIndex = -1;

  for (const sp of region.spawnPoints) {
    if (!isOreSpawn(sp)) continue;
    if (!sp.spawnId.startsWith(prefix)) continue;
    const suffix = sp.spawnId.slice(prefix.length);
    const idx = parseInt(suffix, 10);
    if (Number.isFinite(idx) && idx > maxIndex) {
      maxIndex = idx;
    }
  }

  return maxIndex + 1;
}

/**
 * Build a deterministic-ish placement around an anchor spawn.
 *
 * We don't need perfect blue-noise here; just something that:
 *  - stays "near" the settlement
 *  - doesn't stack nodes on top of each other too much
 */
function placeOreNearAnchor(
  region: RegionSnapshot,
  anchor: { settlement: SettlementSnapshot; spawn: SpawnPointSnapshot },
  slug: string,
  index: number,
  ordinal: number,
): BrainActionUpsertSpawn {
  const base = anchor.spawn;

  // Golden-angle spiral-ish pattern
  const angleDeg = 137.5 * ordinal;
  const angleRad = (angleDeg * Math.PI) / 180;

  const ring = Math.floor(ordinal / 3); // 3 nodes per ring
  const radius = 10 + ring * 5; // meters-ish in world units

  const x = (base.x ?? 0) + Math.cos(angleRad) * radius;
  const z = (base.z ?? 0) + Math.sin(angleRad) * radius;
  const y = base.y ?? 0;

  const spawnId = `ore_${slug}_${index}`;

  const action: BrainActionUpsertSpawn = {
    kind: "upsert_spawn",
    source: "ResourceBaseline",
    spawn: {
      shardId: region.shardId,
      spawnId,
      type: "node",
      protoId: ORE_PROTO_ID,
      variantId: null,
      archetype: ORE_ARCHETYPE,
      x,
      y,
      z,
      regionId: region.id,
      meta: {
        planner: "ResourceBaseline_v1",
        anchorSettlementId: anchor.settlement.id,
        anchorSpawnId: anchor.spawn.spawnId,
        dangerTier: region.dangerTier,
      },
    },
  };

  return action;
}

/**
 * Core planner: for each region, top up ore nodes to
 * the target count and emit upsert_spawn actions.
 */
export function planResourceBaseline(ctx: BrainContext): BrainAction[] {
  const actions: BrainAction[] = [];

  for (const region of ctx.regions) {
    const anchors = getAnchors(region);
    if (anchors.length === 0) continue;

    const existing = getExistingOreSpawns(region);
    const target = getTargetOreCount(region);

    const missing = target - existing.length;
    if (missing <= 0) continue;

    const slug = slugRegionId(region.id);
    let index = nextOreIndex(region, slug);
    let ordinal = 0;

    for (let i = 0; i < missing; i++) {
      const anchor = anchors[ordinal % anchors.length];
      const action = placeOreNearAnchor(region, anchor, slug, index, ordinal);

      actions.push(action);

      index++;
      ordinal++;
    }
  }

  return actions;
}

/**
 * Mother Brain module wrapper.
 */
export const ResourceBaselineModule: BrainModule = (ctx: BrainContext) =>
  planResourceBaseline(ctx);
